/**
 * The entrypoint for the action.
 */
import { run } from "./main";

run()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
