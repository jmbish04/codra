// Simulate the full cleaning pipeline to find where the issue is

const cleanText = (text) => {
  let current = text.trim();
  let prev = '';
  while (current !== prev) {
    prev = current;
    current = current
      .replace(/^([\u{1F300}-\u{1F9FF}]|\[QUALITY\]|\[SECURITY\]|\[BUG\]|\[P[0-3]\]|\[NIT\]|QUALITY|SECURITY|BUG|P[0-3]|NIT|[:\-\s\uFE0F]|[^\w\s])+/giu, '')
      .trim();
  }
  return current;
};

// These are what the model actually returns (as shown in the raw model output in the dashboard)
const modelOutputFindings = [
  {
    title: "[P0] Hardcoded API credentials and database password",
    body: "Lines 9-10 contain hardcoded secrets (Stripe test key and database password) committed to source control. This is a critical security vulnerability exposing sensitive credentials.",
  },
  {
    title: "[P0] SQL injection vulnerability in database query",
    body: "Line 95 constructs SQL queries via string concatenation with unsanitized user input (orderId), allowing arbitrary SQL injection attacks.",
  },
  {
    title: "[P1] Remote code execution via eval() parsing",
    body: "Lines 43-44 use eval() to parse JSON strings, enabling arbitrary code execution if optionsRaw contains malicious JavaScript. Use JSON.parse() instead.",
  },
  {
    title: "[P2] Implicit global variable pollution",
    body: "Line 63 declares taxRate without let/const/var, creating a global variable that pollutes the global namespace and could cause silent conflicts with other modules.",
  },
];

console.log('=== After cleanText (model-output.ts processing) ===\n');
for (const finding of modelOutputFindings) {
  const title = cleanText(finding.title);
  let body = cleanText(finding.body);

  // Dedup logic (model-output.ts lines 169-172)
  const bodyPrefix = cleanText(body.split('\n')[0]);
  if (
    bodyPrefix.toLowerCase().startsWith(title.toLowerCase()) ||
    title.toLowerCase().startsWith(bodyPrefix.toLowerCase())
  ) {
    body = cleanText(body.slice(body.split('\n')[0].length));
  }

  console.log('Title stored in DB:', JSON.stringify(title));
  console.log('Body stored in DB: ', JSON.stringify(body));
  console.log();
}

console.log('\n=== formatInlineComment output (what goes to GitHub) ===\n');

// Now simulate the NEW formatInlineComment with stripLeadingTags
const stripLeadingTags = (text) => {
  let current = text.trim();
  let prev = '';
  while (current !== prev) {
    prev = current;
    current = current
      .replace(/^([\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}]|\[QUALITY\]|\[SECURITY\]|\[BUG\]|\[P[0-3]\]|\[NIT\]|QUALITY|SECURITY|BUG|P[0-3]|NIT|[:\-\s\uFE0F]|[^\w\s])+/giu, '')
      .trim();
  }
  return current;
};

for (const finding of modelOutputFindings) {
  // Simulate what's already in DB (after cleanText ran)
  const storedTitle = cleanText(finding.title);
  let storedBody = cleanText(finding.body);
  const bodyPrefix = cleanText(storedBody.split('\n')[0]);
  if (
    bodyPrefix.toLowerCase().startsWith(storedTitle.toLowerCase()) ||
    storedTitle.toLowerCase().startsWith(bodyPrefix.toLowerCase())
  ) {
    storedBody = cleanText(storedBody.slice(storedBody.split('\n')[0].length));
  }

  // Now formatInlineComment with new stripLeadingTags
  let body = stripLeadingTags(storedBody);
  const firstLine = body.split('\n')[0].trim();
  const cleanFirstLine = stripLeadingTags(firstLine);
  if (
    cleanFirstLine.toLowerCase().startsWith(storedTitle.toLowerCase()) ||
    storedTitle.toLowerCase().startsWith(cleanFirstLine.toLowerCase())
  ) {
    body = body.slice(firstLine.length).replace(/^[\n\r]+/, '');
  }

  const comment = `[SVG_ICON] **${storedTitle}**\n\n${body}`;
  console.log(comment);
  console.log('---');
}

// Now test with STALE DB data (pre-cleanText era — body has the full emoji+tag prefix)
console.log('\n=== STALE DB DATA (pre-cleanText) — formatInlineComment ===\n');
const staleComments = [
  {
    title: "Hardcoded API credentials and database password",
    // Stored body from OLD parse (before cleanText was added):
    body: "🔥 [QUALITY] [P0] Hardcoded API credentials and database password\n\nLines 9-10 contain hardcoded secrets...",
    severity: "P0",
  },
  {
    title: "Implicit global variable pollution",  
    body: "🟡 [QUALITY] [P2] Implicit global variable pollution\n\nLine 63 declares taxRate without let/const/var...",
    severity: "P2",
  },
];

for (const comment of staleComments) {
  let body = stripLeadingTags(comment.body);
  const firstLine = body.split('\n')[0].trim();
  const cleanFirstLine = stripLeadingTags(firstLine);
  console.log('After stripLeadingTags body firstLine:', JSON.stringify(firstLine));
  console.log('cleanFirstLine:', JSON.stringify(cleanFirstLine));
  console.log('title:', JSON.stringify(comment.title));
  if (
    cleanFirstLine.toLowerCase().startsWith(comment.title.toLowerCase()) ||
    comment.title.toLowerCase().startsWith(cleanFirstLine.toLowerCase())
  ) {
    body = body.slice(firstLine.length).replace(/^[\n\r]+/, '');
    console.log('Deduped!');
  }
  console.log('Final body:', JSON.stringify(body));
  console.log(`[SVG_ICON] **${comment.title}**\n\n${body}`);
  console.log('---');
}
