import { debug } from "@actions/core";

export interface PruneOptions {
    /** @var string Domain name of the registry */
    domain: string;
    /** @var string Username for auth */
    user: string;
    /** @var string Password for auth */
    password: string;
    /** @var string The image for which you want to clean the tags */
    image: string;
    /** @var RegExp Matcher for tags we want to keep */
    regex: RegExp;
}

/**
 * A bi-directional map between tags and image references, built from getting
 * all the metadata of the registry.
 */
export interface TagMap {
    tagToRef: Record<string, string>;
    refToTags: Record<string, string[]>;
}

interface RegistryTagList {
    name: string;
    tags: string[];
}

interface RegistryManifest {
    config: {
        digest: string;
    };
}

const WAIT_PERIOD_MS = 50;

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithAuth(
    url: string,
    user: string,
    password: string
): Promise<Response> {
    const authHeader = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
    return fetch(url, {
        headers: {
            Authorization: authHeader,
            Accept: "application/vnd.docker.distribution.manifest.v2+json",
        },
    });
}

/**
 * Makes sure that the domain is prefixed by the scheme, https by default but
 * we leave the scheme alone if specified.
 */
function domainToBase(domain: string): string {
    if (!/^https?:\/\//.test(domain)) {
        return `https://${domain}`;
    } else {
        return domain;
    }
}

/**
 * Re-generates the options making sure that the domain is actually a valid base
 * URL.
 */
function normalizeOptions(options: PruneOptions): PruneOptions {
    return {
        ...options,
        domain: domainToBase(options.domain),
    };
}

async function makeTagMap(
    options: Omit<PruneOptions, "regex">
): Promise<TagMap> {
    const { domain, user, password, image } = options;
    const tagMap: TagMap = { tagToRef: {}, refToTags: {} };
    let requestCount = 0;

    async function fetchJson<T>(url: string): Promise<T> {
        await sleep(WAIT_PERIOD_MS * requestCount);
        requestCount += 1;

        const response = await fetchWithAuth(url, user, password);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return (await response.json()) as Promise<T>;
    }

    const { tags } = await fetchJson<RegistryTagList>(
        `${domain}/v2/${image}/tags/list`
    );
    debug(`Found tags: ${JSON.stringify(tags).slice(1, -1)}`);
    requestCount = 0;

    for (const tag of tags) {
        const manifest = await fetchJson<RegistryManifest>(
            `${domain}/v2/${image}/manifests/${tag}`
        );
        const imageRef = manifest.config.digest;
        debug(`Found tag ${tag} has ref ${imageRef}`);

        tagMap.tagToRef[tag] = imageRef;
        tagMap.refToTags[imageRef] = [
            ...(tagMap.refToTags[imageRef] || []),
            tag,
        ];
    }

    return tagMap;
}

/**
 * We'll list all the tags that don't match our specification and return a list
 * of them. We need to kill them.
 */
function makeKillList(map: TagMap, regex: RegExp): string[] {
    const keep: Set<string> = new Set();

    for (const [tag, ref] of Object.entries(map.tagToRef)) {
        if (regex.test(tag)) {
            for (const keepTag of map.refToTags[ref]) {
                keep.add(keepTag);
            }
        }
    }

    return Object.keys(map.tagToRef).filter((t) => !keep.has(t));
}

async function deleteTags(
    options: PruneOptions,
    killList: string[]
): Promise<undefined> {
    const { domain, user, password, image } = options;
    let requestCount = 0;

    for (const tag of killList) {
        await sleep(WAIT_PERIOD_MS * requestCount);
        requestCount += 1;

        const url = `${domain}/v2/${image}/manifests/${tag}`;

        // First, we need to get the digest of the manifest
        const getResponse = await fetchWithAuth(url, user, password);
        if (!getResponse.ok) {
            debug(
                `Failed to get manifest for tag ${tag}: ${getResponse.status} ${getResponse.statusText}`
            );
            continue;
        }
        const digest = getResponse.headers.get("Docker-Content-Digest");

        if (!digest) {
            debug(`No digest found for tag ${tag}`);
            continue;
        }

        // Now we can delete the manifest using the digest
        const deleteUrl = `${domain}/v2/${image}/manifests/${digest}`;
        const deleteResponse = await fetch(deleteUrl, {
            method: "DELETE",
            headers: {
                Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`,
            },
        });

        if (deleteResponse.ok) {
            debug(`Successfully deleted tag ${tag}`);
        } else {
            debug(
                `Failed to delete tag ${tag}: ${deleteResponse.status} ${deleteResponse.statusText}`
            );
        }
    }
}

export async function prune(options: PruneOptions): Promise<undefined> {
    const normOptions = normalizeOptions(options);
    const map = await makeTagMap(normOptions);
    const killList = makeKillList(map, normOptions.regex);

    debug(`Killing tags: ${JSON.stringify(killList).slice(1, -1)}`);

    await deleteTags(normOptions, killList);
}
