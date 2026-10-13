import {validateRevision} from './artifacts.mjs';
import { ensure, strictKeys, canonical, sha256 } from './util.mjs';
import { validateComputerSpec, isComputerSpec, fileType, safeArtifactName, validateBundle, bundleZIP, MAX_FILE_BYTES } from './artifacts.mjs';
import { validateImageSpec, isImageSpec, decodeImage, evaluateImage } from './images.mjs';

// The editor remains a legacy-sized convenience. Imported v2 specifications
// retain their exact runtime identity, authority, byte budgets and criteria.
export const STUDIO_LIMITS = Object.freeze({legacyFiles:24, legacyOutputBytes:4194304, generalFiles:64, generalFileBytes:33554432, generalOutputBytes:67108864, generalDeliveryBytes:94371840, recordBytes:201326592});

// These are editable starting points, not measured capability or quality claims.
const FORMAT_TEMPLATES = [
  { id:'research', label:'Research & compare', icon:'01', description:'Public sources → a clear, cited report.', title:'Compare three public alternatives', prompt:'Compare three public open-source tools for organizing a small community project. Browse their official documentation. Explain strengths, limitations and who each suits. State the date of your research and link the sources. Do not invent prices or test results.', outputs:['comparison.docx','comparison.pdf','sources.md'], criteria:['Compare three alternatives using the same criteria and primary sources.','Distinguish verified facts from judgment; include source URLs and access date.','Open and render the report; check that headings and tables fit the pages.'] },
  { id:'spreadsheet', label:'Spreadsheets & analysis', icon:'02', description:'Data → formulas, charts and checked totals.', title:'Build a small project budget', prompt:'Create a project budget using this synthetic data: design 12 hours at 50 per hour; engineering 20 hours at 80 per hour; testing 8 hours at 40 per hour. Add a 10% contingency. Include formulas and a chart. Currency is USD. Explain the assumptions. Recalculate the workbook and verify the totals.', outputs:['budget.xlsx','notes.md'], criteria:['Base cost is 2520 USD; contingency is 252 USD; total is 2772 USD.','Line totals, subtotal, contingency and grand total use working spreadsheet formulas.','Recalculate and visually inspect the workbook; keep the chart and labels readable.'] },
  { id:'presentation', label:'Presentations', icon:'03', description:'An idea → readable slides and a PDF.', title:'Explain a community repair café', prompt:'Create a six-slide proposal for a volunteer community repair café: purpose, audience, event plan, roles, illustrative budget and next steps. Label any invented figures as illustrative. Use clear typography, a consistent palette and a calm professional style. Render the slides and inspect them for overflow.', outputs:['proposal.pptx','proposal.pdf'], criteria:['Include exactly six slides covering the requested topics.','State assumptions and clearly label illustrative figures.','Render and inspect every slide; no clipped text, overlapping elements or unreadable labels.'] },
  { id:'document', label:'Documents & PDFs', icon:'04', description:'A brief → a polished document you can edit.', title:'Write an event operating guide', prompt:'Write a concise operating guide for a fictional public community workshop: preparation, equipment, volunteer roles, schedule and cleanup. Include a one-page checklist. Do not collect personal information. Produce an editable document and matching PDF.', outputs:['guide.docx','guide.pdf'], criteria:['Cover preparation, equipment, roles, schedule and cleanup with useful specific steps.','Include a practical one-page checklist.','Render and inspect the files for readable layout and matching content.'] },
  { id:'website', label:'Websites & interfaces', icon:'05', description:'A brief → a small website and preview evidence.', title:'Build a community workshop website', prompt:'Build a responsive static landing page for a fictional repair café. Include event details, what to bring, an FAQ and accessible navigation. Use HTML/CSS/JavaScript only with no remote dependencies, forms that send data, or publication. Inspect desktop and mobile layouts and document what you tested.', outputs:['index.html','style.css','app.js','README.md','preview.png'], criteria:['Implement all requested sections and clearly label fictional event details.','The site works locally without remote scripts, trackers or external network calls.','Check keyboard navigation and mobile layout; provide an actual rendered preview.'] },
  { id:'code', label:'Code & automation', icon:'06', description:'A specification → code, tests and run notes.', title:'Create a CSV summary utility', prompt:'Write a small Python standard-library command-line utility that reads a CSV with category and amount columns, sums decimal amounts by category and outputs sorted JSON. Reject malformed rows and non-finite amounts. Include unit tests with valid and invalid cases, a sample CSV, and simple run instructions. Execute the tests in the isolated workspace and report actual results.', outputs:['summarize.py','test_summarize.py','sample.csv','README.md'], criteria:['Use decimal-safe arithmetic, deterministic sorted output and clear input errors.','Provide and execute tests for normal data, malformed rows and non-finite amounts.','Document exact commands, observed test results and limitations without inventing success.'] },
  { id:'data', label:'Data & quality checks', icon:'07', description:'Small public data → clean files and an audit trail.', title:'Clean and explain a tiny dataset', prompt:'Clean this synthetic CSV: name,quantity\nPencils,12\npencils,12\nPaper,5\nErasers,3\nPaper,5\n. Normalize names to lowercase, remove duplicate rows, sort by name and produce a JSON summary with row count and total quantity. Document every transformation.', outputs:['clean.csv','summary.json','changes.md'], criteria:['The cleaned CSV has erasers 3, paper 5 and pencils 12, sorted by name.','The JSON summary reports 3 rows and total quantity 20.','The change log accurately describes normalization, deduplication and sorting.'] },
  { id:'design', label:'Visual design', icon:'08', description:'A visual brief → editable art and a preview.', title:'Design a repair café poster', prompt:'Design a clean, original poster for a fictional Repair Café, Saturday 14:00–17:00, Community Hall. Include Bring an item. Learn a skill. Give it another life. Use editable SVG and export a PNG preview. Avoid brand logos or private information.', outputs:['poster.svg','poster.png'], criteria:['Include all specified event text, accurately spelled and readable.','Use clear visual hierarchy, sufficient contrast and a balanced composition.','Open the SVG and inspect the rendered PNG; both should show the same design.'] },
  { id:'image', label:'Generate an image', icon:'09', description:'A visual idea → an actual generated PNG.', title:'Illustrate a community workshop', prompt:'Create an inviting editorial illustration of a fictional community repair workshop, with people fixing everyday objects, warm natural light and an optimistic atmosphere. No text, logos or identifiable real people.', outputs:['image.png'], criteria:['Clearly depict a welcoming repair workshop with people working on everyday objects.','Use a coherent composition with clear focal points and warm natural light.','Do not include text, logos, watermarks or identifiable real people.'] },
];

export const STUDIO_TEMPLATES=[...[
  {
    "id": "performance",
    "label": "Performance optimization",
    "icon": "01",
    "description": "Profile, improve, prove.",
    "title": "Optimize a deterministic public-data join",
    "prompt": "Implement a reproducible baseline and optimized Python join of generated public fixture records. Use fixed seeds and validate identical results. Measure multiple warmed runs on this sandbox, report sizes, median times, memory method and uncertainty. Avoid fabricated speedups. Keep generated data small enough for this machine.",
    "outputs": [
      "benchmark.py",
      "test_benchmark.py",
      "results.csv",
      "analysis.md"
    ],
    "criteria": [
      "Baseline and optimized outputs are exactly equal across edge cases.",
      "Include executable correctness tests and repeatable benchmark commands.",
      "Report only measured timing with environment, warmup, repetitions and limitations."
    ],
    "category": "professional",
    "environment": "Python standard library; bounded CPU and memory",
    "publicInputs": "Generated nonpersonal records; seed and sizes recorded",
    "checkMethod": "Execute tests, compare output hashes, repeat timings."
  },
  {
    "id": "open-source",
    "label": "Open-source feature",
    "icon": "02",
    "description": "A scoped change with regression evidence.",
    "title": "Add a bounded public-project feature",
    "prompt": "Choose a small permissively licensed public Python project and a narrowly defined feature. Record the exact upstream repository URL, commit, license and relevant input-file hashes. Implement the feature in a small standalone reproducible patch bundle represented by changed source files. Include before/after behavior and tests. If the repository or dependencies are unavailable, stop with the exact missing input; do not substitute an invented upstream project. No commits or pull requests are published.",
    "outputs": [
      "change.zip",
      "test-results.txt",
      "README.md"
    ],
    "criteria": [
      "Record exact upstream commit, license and input hashes.",
      "Implement a documented user-visible behavior and test regression cases.",
      "Provide a reproducible local application procedure and actual test output."
    ],
    "category": "professional",
    "environment": "Python, git read-only, public repository access",
    "publicInputs": "Operator-selected public repository and bounded feature brief",
    "checkMethod": "Apply to the recorded commit and execute relevant tests."
  },
  {
    "id": "sdk",
    "label": "API SDK / tooling",
    "icon": "03",
    "description": "Typed interfaces, retries and fixtures.",
    "title": "Build a small OpenAPI client",
    "prompt": "Build a dependency-free JavaScript client and TypeScript declarations for a local fixture API: GET /items with cursor pagination and GET /items/{id}. Create a small OpenAPI description and mock HTTP server. Handle timeout, cancellation, malformed JSON, 429 Retry-After and bounded retry of idempotent GET only. Use fixture data and no private service credentials.",
    "outputs": [
      "client.js",
      "client.d.ts",
      "openapi.json",
      "test_client.mjs",
      "README.md"
    ],
    "criteria": [
      "Client pagination and typed interfaces agree with the supplied OpenAPI fixture.",
      "Tests cover timeouts, cancellation, malformed responses and bounded retries.",
      "Run tests against a local mock; make no claim of live API compatibility."
    ],
    "category": "professional",
    "environment": "Node.js built-in HTTP, fetch, test runner",
    "publicInputs": "Explicitly labelled local public fixture API",
    "checkMethod": "Execute client tests against a local mock server."
  },
  {
    "id": "test-suite",
    "label": "Automated test suite",
    "icon": "04",
    "description": "Find regressions and explain coverage.",
    "title": "Test a decimal-safe invoice calculator",
    "prompt": "Write a small Python decimal invoice calculator plus an adversarial test suite. Define tax rounding and discount order explicitly. Include zero, negative and malformed input, boundary rounding, very large finite values and duplicate line identifiers. Add seeded property-style invariants using the standard library. Execute every test; explain coverage gaps without claiming complete correctness.",
    "outputs": [
      "invoice.py",
      "test_invoice.py",
      "test-results.txt",
      "coverage-notes.md"
    ],
    "criteria": [
      "Rules for decimal rounding, tax and discount ordering are explicit and consistent.",
      "Tests exercise normal, boundary and invalid inputs with deterministic invariants.",
      "Provide actual executed results and at least three remaining limitations."
    ],
    "category": "professional",
    "environment": "Python standard library unittest and decimal",
    "publicInputs": "Synthetic financial arithmetic fixtures; no customer records",
    "checkMethod": "Execute deterministic tests and inspect failed-case messages."
  },
  {
    "id": "ai-evaluation",
    "label": "AI evaluation package",
    "icon": "05",
    "description": "A reproducible rubric with honest evidence.",
    "title": "Create a grounded-answer evaluation harness",
    "prompt": "Build an offline evaluation package for citation-grounded question answering. Supply ten public-domain fixture passages, questions, expected evidence spans and adversarial unsupported claims. Write a Python scorer for format and citation coverage, an explicit human quality rubric, and a report distinguishing deterministic checks from semantic judgment. Do not call any paid model or invent model scores; include a clearly labelled dummy adapter for operator connection later.",
    "outputs": [
      "evaluate.py",
      "cases.json",
      "rubric.md",
      "fixture-results.json",
      "README.md"
    ],
    "criteria": [
      "Every expected answer is supported by an included passage and span.",
      "Unsupported-claim and malformed-output cases are tested.",
      "Dummy results are clearly labelled and never represented as live model measurements."
    ],
    "category": "professional",
    "environment": "Python; optional future operator-supplied provider adapter",
    "publicInputs": "Included public-domain passages with provenance",
    "checkMethod": "Run scorer on labelled fixtures; human rubric remains separate."
  },
  {
    "id": "dashboard",
    "label": "Public-data dashboard",
    "icon": "06",
    "description": "Traceable inputs and a useful interface.",
    "title": "Build an accessible public-data dashboard",
    "prompt": "Use one small public CSV dataset selected by the operator. Record the source URL, retrieval date, license, SHA-256 and schema. Build an offline HTML/CSS/JS dashboard with filters, missing-data disclosure, accessible table and two meaningful charts rendered without remote dependencies. Preserve raw data separately and document transformations. If the source has not been selected, use an explicitly labelled synthetic preview and flag replacement as required.",
    "outputs": [
      "index.html",
      "style.css",
      "app.js",
      "data.csv",
      "data-notes.md",
      "preview.png"
    ],
    "criteria": [
      "Every plotted value reconciles to the supplied CSV and documented transformations.",
      "Filters, keyboard navigation, empty states and narrow screens work.",
      "Include an actual rendered preview and explicit source/fixture provenance."
    ],
    "category": "professional",
    "environment": "Browser, JavaScript, Python CSV validation",
    "publicInputs": "One permitted public CSV, or labelled synthetic preview",
    "checkMethod": "Reconcile totals, test filters, inspect desktop and mobile."
  },
  {
    "id": "interactive-demo",
    "label": "Interactive software demo",
    "icon": "07",
    "description": "A working concept you can inspect.",
    "title": "Build a scheduling simulator",
    "prompt": "Create an offline interactive scheduling demo for a small team using synthetic tasks with duration, dependency and resource count. Show a time-ordered schedule and make capacity adjustable. Detect cycles and infeasible inputs. Explain the heuristic and explicitly avoid claiming global optimization. Include a static accessible table matching the timeline. No external services or data submission.",
    "outputs": [
      "index.html",
      "style.css",
      "app.js",
      "tests.mjs",
      "README.md",
      "preview.png"
    ],
    "criteria": [
      "Dependency and capacity constraints hold for every displayed schedule.",
      "Tests cover cycles, empty inputs and invalid duration/resource values.",
      "Controls work with a keyboard and the table agrees with the timeline."
    ],
    "category": "professional",
    "environment": "Node.js and browser; no third-party runtime",
    "publicInputs": "Synthetic tasks embedded in the demo",
    "checkMethod": "Execute scheduling invariants and inspect rendered interaction."
  },
  {
    "id": "vendor-intelligence",
    "label": "Vendor / product intelligence",
    "icon": "08",
    "description": "Primary sources and a decision record.",
    "title": "Compare three public software products",
    "prompt": "Compare three operator-selected software products for a defined organizational use case. Research official product documentation and pricing pages. Use consistent criteria: capabilities, integration, data export, deployment model, accessibility documentation and total-cost assumptions. Include source URLs, access dates, unknowns and a decision matrix. Separate vendor claims from tested behavior; do not fabricate hands-on tests.",
    "outputs": [
      "comparison.docx",
      "comparison.pdf",
      "matrix.csv",
      "sources.md"
    ],
    "criteria": [
      "Use comparable criteria and primary sources for all three products.",
      "Document prices with dates, units and assumptions; mark unavailable facts unknown.",
      "State the use-case recommendation, tradeoffs, uncertainty and untested claims."
    ],
    "category": "professional",
    "environment": "Public web research; document and PDF rendering",
    "publicInputs": "Operator-defined products and public official pages",
    "checkMethod": "Verify cited claims and render the final report."
  },
  {
    "id": "executable-docs",
    "label": "Executable documentation",
    "icon": "09",
    "description": "Instructions that run as written.",
    "title": "Document and test a reproducible CSV pipeline",
    "prompt": "Build a small Python standard-library CSV validation and aggregation pipeline and executable technical documentation. Include input schema, deterministic sample data, exact commands, expected output and troubleshooting. A check_docs.py script must run the documented commands in a temporary directory and compare actual output with golden fixtures. Avoid external setup dependencies.",
    "outputs": [
      "pipeline.py",
      "check_docs.py",
      "sample.csv",
      "expected.json",
      "README.md"
    ],
    "criteria": [
      "A clean temporary directory can execute every documented command.",
      "Actual outputs match versioned golden fixtures.",
      "Errors identify the failing row or field without a Python traceback for user input mistakes."
    ],
    "category": "professional",
    "environment": "Python standard library; temporary workspace",
    "publicInputs": "Small explicitly labelled synthetic CSV fixture",
    "checkMethod": "Run the documentation checker from a clean directory."
  },
  {
    "id": "numerical-reproduction",
    "label": "Scientific / numerical reproduction",
    "icon": "10",
    "description": "Equations, tolerances and repeatability.",
    "title": "Reproduce a numerical convergence result",
    "prompt": "Reproduce convergence of numerical integration for the analytic function exp(x) on [0,1] using composite trapezoidal and Simpson rules. Use Python standard library only, the analytic integral exp(1)-1, powers-of-two grids and explicit floating-point limits. Produce error/convergence tables and a self-contained SVG plot. Explain the equations, expected order, actual measured order and where roundoff dominates. No claim of reproducing an unspecified paper.",
    "outputs": [
      "reproduce.py",
      "test_reproduce.py",
      "convergence.csv",
      "convergence.svg",
      "report.md"
    ],
    "criteria": [
      "Calculated integrals agree with the analytic reference within stated tolerances.",
      "Measured convergence order is reported only over the non-roundoff regime.",
      "Tests, fixed commands and error table regenerate the claimed results."
    ],
    "category": "professional",
    "environment": "Python math, unittest; SVG rendering",
    "publicInputs": "Analytic public mathematical function and documented equations",
    "checkMethod": "Execute tests, regenerate tables and inspect the plot."
  }
],...FORMAT_TEMPLATES.map(t=>({...t,category:"format"}))];

export function studioSpec(value) {
  if (isComputerSpec(value)) {
    const specification = validateComputerSpec(value);
    ensure(specification.dataPolicy === 'public', 'STUDIO_PUBLIC_WORK_REQUIRED');
    if (specification.profile === 'computer-work/v2') ensure(['agent','reviewer'].every(role => specification.authority[role].scope === 'isolated-public'), 'STUDIO_PUBLIC_WORK_REQUIRED');
    return specification;
  }
  if (isImageSpec(value)) return validateImageSpec(value);
  ensure(false, 'STUDIO_PROFILE_REQUIRED');
}

export function composeStudio(input) {
  strictKeys(input, ['template','title','prompt','outputs','criteria'], 'STUDIO_BRIEF_INVALID');
  const template = STUDIO_TEMPLATES.find(t => t.id === input.template);
  ensure(template, 'STUDIO_BRIEF_INVALID');
  ensure(typeof input.title === 'string' && typeof input.prompt === 'string', 'STUDIO_BRIEF_INVALID');
  ensure(Array.isArray(input.criteria) && input.criteria.length > 0 && input.criteria.length <= 16 && input.criteria.every(s => typeof s === 'string' && s.trim().length > 0 && s.length <= 500), 'STUDIO_CRITERIA_REQUIRED');
  const base = {schema:'agi-node-job/v1', title:input.title.trim(), prompt:input.prompt.trim(), dataPolicy:'public', criteria:input.criteria.map((requirement,i) => ({id:`check-${i+1}`, requirement:requirement.trim()}))};
  if (template.id === 'image') {
    ensure(Array.isArray(input.outputs) && input.outputs.length === 1 && input.outputs[0] === 'image.png', 'STUDIO_IMAGE_OUTPUT');
    return validateImageSpec({...base, profile:'image-png/v1', width:1024, height:1024, maxBytes:MAX_FILE_BYTES});
  }
  ensure(Array.isArray(input.outputs) && input.outputs.length > 0 && input.outputs.length <= 24, 'STUDIO_OUTPUTS_REQUIRED');
  const maxBytes = Math.floor(MAX_FILE_BYTES / input.outputs.length);
  return validateComputerSpec({...base, profile:'computer-work/v1', inputs:[], outputs:input.outputs.map(name => {
    safeArtifactName(name);
    return {name, mediaType:fileType(name), maxBytes, requirement:'Fulfil the complete task and acceptance criteria in this file; open and check it before delivery.'};
  })});
}

export function deliveryInfo(specification, delivery) {
  studioSpec(specification);
  ensure(typeof delivery === 'string' && Buffer.byteLength(delivery) <= (specification?.profile==='computer-work/v2'?STUDIO_LIMITS.generalDeliveryBytes:6291456), 'STUDIO_DELIVERY_TOO_LARGE');
  if (isComputerSpec(specification)) {
    const bytes = Buffer.from(delivery), {bundle} = validateBundle(specification, bytes);
    return {deliveryHash:sha256(bytes), files:bundle.files.map(({content,...meta}) => meta)};
  }
  const bytes = decodeImage(delivery);
  ensure(evaluateImage(specification,bytes).decision === 'approve', 'STUDIO_IMAGE_INVALID');
  return {deliveryHash:sha256(bytes), files:[{name:'image.png', mediaType:'image/png', bytes:bytes.length, sha256:sha256(bytes)}]};
}

export function makeHandoff(specification, delivery) {
  const {deliveryHash} = deliveryInfo(specification, delivery);
  return {schema:'agi-studio-handoff/v1', specification, specHash:sha256(canonical(specification)), delivery, deliveryHash};
}

export function validateHandoff(value) {
  strictKeys(value, ['schema','specification','specHash','delivery','deliveryHash'], 'STUDIO_HANDOFF_INVALID');
  ensure(value.schema === 'agi-studio-handoff/v1', 'STUDIO_HANDOFF_INVALID');
  const clean = makeHandoff(value.specification, value.delivery);
  ensure(value.specHash === clean.specHash && value.deliveryHash === clean.deliveryHash, 'STUDIO_HANDOFF_HASH');
  return clean;
}

export function studioDownload(handoff) {
  const h = validateHandoff(handoff);
  const image = isImageSpec(h.specification);
  const bytes = image ? decodeImage(h.delivery) : bundleZIP(h.specification, Buffer.from(h.delivery));
  return {name:image?'image.png':'deliverables.zip', mediaType:image?'image/png':'application/zip', content:bytes.toString('base64')};
}

export function makeRevision(handoff, review) {
 const h = validateHandoff(handoff);
 validateRevision(h.specification, {delivery:h.delivery, review});
 return {schema:'agi-studio-revision/v1', handoff:h, review};
}
export function validateStudioRevision(value) {
 strictKeys(value, ['schema','handoff','review'], 'STUDIO_REVISION_INVALID');
 ensure(value.schema === 'agi-studio-revision/v1', 'STUDIO_REVISION_INVALID');
 return makeRevision(value.handoff,value.review);
}
