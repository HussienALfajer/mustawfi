import { resolve } from "node:path";
import { verify } from "./verify.ts";

process.exitCode = await verify(resolve(import.meta.dirname, "../../.."));
