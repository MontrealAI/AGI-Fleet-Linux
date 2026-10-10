#!/usr/bin/env node
import fs from "node:fs";
import { estimate } from "../ops/workload.mjs";
const args=process.argv.slice(2);
if(args.length!==2) {
  console.error("Usage: node scripts/labor-report.mjs case3_moderate|case4_conservative examples/labor-assumptions.json");
  process.exitCode=1;
} else {
  try {console.log(JSON.stringify(estimate(args[0],JSON.parse(fs.readFileSync(args[1],"utf8"))),null,2));}
  catch(e) {console.error(e.code ?? e.message);process.exitCode=1;}
}
