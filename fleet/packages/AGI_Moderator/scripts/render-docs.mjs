import {execFileSync} from 'node:child_process';
import {digest,headingIds} from './guide-support.mjs';
import fs from "node:fs";
import path from "node:path";
import { marked } from "marked";
import { ROOT } from "../ops/common.mjs";
execFileSync(process.execPath,[path.join(ROOT,'scripts/current-guides.mjs'), ...(process.argv.includes('--check')?[]:['--write'])],{stdio:'inherit'});
const css = `*{box-sizing:border-box}html{color-scheme:dark}body{margin:0;background:#0b101c;color:#eef3ff;font:16px/1.7 system-ui,-apple-system,sans-serif}main{overflow-wrap:anywhere;max-width:1080px;margin:auto;padding:36px 24px 80px}a{color:#a8dcff;text-underline-offset:4px}nav{font-size:13px;padding-bottom:20px;border-bottom:1px solid #45516b;margin-bottom:30px;color:#c8b7ed}h1{font-size:clamp(32px,5vw,49px);letter-spacing:-.04em;line-height:1.15}h2{font-size:25px;margin-top:42px;line-height:1.3}h3{font-size:19px}p,li{color:#c4cfe1}li{margin:9px 0}table{display:block;overflow:auto;border-collapse:collapse;width:100%;font-size:14px;background:#131d30}th,td{padding:12px 15px;text-align:left;border-bottom:1px solid #44516c;min-width:145px}th{background:#25304a;color:#edf3ff}pre{padding:20px;background:#080d17;color:#d3e7ff;border:1px solid #405272;border-radius:12px;overflow:auto;white-space:pre-wrap;word-break:break-word}code{font-size:13px;overflow-wrap:anywhere}blockquote{border-left:3px solid #b3a0dc;padding-left:18px;margin-left:0}img{max-width:100%;height:auto;border-radius:12px}hr{border:0;border-top:1px solid #45516b;margin:35px 0}@media(max-width:550px){main{padding:24px 17px 60px}table{font-size:13px}h2{font-size:22px}}@media print{body{background:#fff;color:#111}p,li,a{color:#222}pre,table,th{background:#fff;color:#111}nav{display:none}}
body{background:radial-gradient(ellipse at top right,#48245544,transparent 55%),#0c0912;color:#f4e8fa}main{max-width:1080px}nav{color:#c7a4de;border-color:#5b3b6e}h1{font-family:Georgia,serif;font-weight:400;color:#efd5f7;letter-spacing:-.035em}h2,h3{color:#e7cefa}a{color:#dab8ff}p,li{color:#c9b6da}pre{background:#1b1027;color:#e8c9fb;border-color:#79588c}table{background:#20142d}th{background:#382446;color:#f0daff}td,th{border-color:#604472}blockquote{border-color:#d5b580}a:focus-visible,summary:focus-visible{outline:3px solid #edcc94;outline-offset:4px}@media print{body{background:white;color:black}h1,h2,h3,p,li,a,td,th,pre{color:black!important}pre,table,th{background:white!important}}
body{background:#0b0d16;color:#f2f4fb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}h1{font-family:inherit;font-weight:600;font-size:clamp(30px,4vw,42px);letter-spacing:-.035em;color:#f3f4fb}h2,h3{color:#e0dff2}p,li{color:#c1c8d9}nav{color:#babdd4;border-color:#45465d}pre{background:#141827;color:#dce1f5;border-color:#50546e}table{background:#171b2a}th{background:#262a3e;color:#edf0fb}td,th{border-color:#474e66}a{color:#c7c5f6}@media print{body{background:white;color:black}h1,h2,h3,p,li,a,td,th,pre{color:black!important}pre,table,th{background:white!important}}`;
for (const name of [
  "README.md",
  "NOTICE.md",
  ...fs
    .readdirSync(path.join(ROOT, "docs"))
    .filter((n) => n.endsWith(".md"))
    .map((n) => "docs/" + n),
]) {
  const md = fs.readFileSync(path.join(ROOT, name), "utf8"),
    title = md.split("\n")[0].replace(/^#+\s*/, ""),
    back = name.includes("/") ? "../START_HERE.html" : "START_HERE.html";
  const body = headingIds(marked
    .parse(md)
    .replace(/href="([^"#:]+)\.md(#[^"]*)?"/g, 'href="$1.html$2"'));
  const destination = path.join(ROOT,name.replace(/\.md$/, ".html"));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="source-sha256" content="${digest(md)}"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</title><style>${css}</style></head><body><main><nav><a href="${back}">← Start here</a> · MONTREAL.AI / AGI FLEET ${JSON.parse(fs.readFileSync(path.join(ROOT,"package.json"),"utf8")).version}</nav>${body}</main></body></html>`;
  if(process.argv.includes("--check")){if(fs.readFileSync(destination,"utf8")!==html)throw Error("Stale HTML: "+name);}else fs.writeFileSync(destination,html);
}
console.log("Rendered all offline fleet guides.");
