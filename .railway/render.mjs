import { createRailwayContext } from "railway/iac";
import program, { partial, target } from "./railway.ts";

// Pure SDK evaluation; no Railway request, token, app, DB or deployment.
const result = await program(createRailwayContext(target));
process.stdout.write(JSON.stringify({ partial, target, project: result }, null, 2) + "\n");
