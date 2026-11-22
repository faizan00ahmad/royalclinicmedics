import { getDb } from "@rmc/db";
import { applyRealContent } from "./real-content";

const force = process.argv.includes("--force");

applyRealContent(getDb(), { force })
  .then((r) => {
    console.log(r === "applied" ? "Real clinic content loaded." : "Already loaded. Use --force to apply it again (this overwrites admin edits to these items).");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
