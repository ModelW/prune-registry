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

interface RegistryManifestEntry {
    digest: string;
    platform: {
        architecture: string;
        os: string;
    };
}

interface RegistryManifest {
    manifests: RegistryManifestEntry[];
}

async function fetchWithAuth(
    url: string,
    user: string,
    password: string,
    accept: string | undefined = undefined
): Promise<Response> {
    const authHeader = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
    return fetch(url, {
        headers: {
            Authorization: authHeader,
            ...(accept ? { Accept: accept } : {}),
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

    async function fetchJson<T>(
        url: string,
        accept: string | undefined = undefined
    ): Promise<T> {
        const response = await fetchWithAuth(url, user, password, accept);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return (await response.json()) as Promise<T>;
    }

    const { tags } = await fetchJson<RegistryTagList>(
        `${domain}/v2/${image}/tags/list`
    );
    debug(`Found tags: ${JSON.stringify(tags).slice(1, -1)}`);

    for (const tag of tags) {
        const manifest = await fetchJson<RegistryManifest>(
            `${domain}/v2/${image}/manifests/${tag}`,
            "application/vnd.oci.image.index.v1+json"
        );

        manifest.manifests.forEach((entry) => {
            if (entry.platform.architecture !== "amd64") {
                return;
            }

            const imageRef = entry.digest;
            debug(`Found tag ${tag} has ref ${imageRef}`);

            tagMap.tagToRef[tag] = imageRef;
            tagMap.refToTags[imageRef] = [
                ...(tagMap.refToTags[imageRef] || []),
                tag,
            ];
        });
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

    for (const tag of killList) {
        const url = `${domain}/v2/${image}/manifests/${tag}`;

        // First, we need to get the digest of the manifest
        const getResponse = await fetchWithAuth(
            url,
            user,
            password,
            "application/vnd.oci.image.index.v1+json"
        );
        if (!getResponse.ok) {
            debug(
                `Failed to get manifest for tag ${tag}: ${getResponse.status} ${getResponse.statusText}`
            );
            continue;
        }

        const manifest = (await getResponse.json()) as RegistryManifest;

        for (const entry of manifest.manifests) {
            const digest = entry.digest;

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
}

export async function prune(options: PruneOptions): Promise<undefined> {
    const normOptions = normalizeOptions(options);
    const map = await makeTagMap(normOptions);
    const killList = makeKillList(map, normOptions.regex);

    debug(`Killing tags: ${JSON.stringify(killList).slice(1, -1)}`);

    await deleteTags(normOptions, killList);
}
