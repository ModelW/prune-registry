import * as core from "@actions/core";
import { prune, PruneOptions } from "./prune";
import { getInput, setFailed } from "@actions/core";

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
    try {
        const options: PruneOptions = {
            domain: getInput('domain'),
            user: getInput('user'),
            password: getInput('password'),
            image: getInput('image'),
            regex: new RegExp(getInput('regex'))
        }

        core.debug(`Parsed input: ${JSON.stringify(options)}`);

        await prune(options);
    } catch (error) {
        if (error instanceof Error) {
            setFailed(`Error: ${error.message}`)
        } else {
            setFailed("Unknown error")
        }

        throw error;
    }
}
