// verify-agent.mjs — verify this corpus from the OUTSIDE, as a consumer.
//
// Everything else in this repository checks the corpus from the inside: the readers against the
// ABCB's XML, the emitters against the format contract, `npm test` against 6,098 files, the CI
// drift guard against the build. All of it answers "is the corpus what the toolchain says it is?"
//
// This answers the other question, the one the whole repository exists for: **can a Claude
// Managed Agents session mount this repository and answer an NCC question out of it?** It creates
// an agent, mounts `vove-ai/aec-assistant-ncc-data` as a `github_repository` session resource,
// gives the agent six tasks, polls the session's events, and grades the transcript.
//
// WHAT THE SIX TASKS PROVE. Each one is a property this repository spent effort on, chosen so a
// failure is diagnostic rather than vague:
//
//   CHECK1  The phrase-grep defect is fixed. "resistance to the incipient spread of fire to the
//           space above" matches on one line in 17 files of corpus/2025/ and 13 of corpus/2022/.
//           In the ABCB's own XML that phrase is split by a cross-reference element and matches
//           ZERO times. This is the reason the corpus exists; if it fails, nothing else matters.
//   CHECK2  Clause-ID lookup lands — including the ambiguity. `c2d2-*` is two files per edition,
//           "Type of construction required" in Volume One and "Invert levels" in Volume Three,
//           and an agent must tell them apart by path and frontmatter rather than take the first.
//   CHECK3  Citation is self-contained. `grep -A6` on a clause ID returns both `citation:` and
//           `web_url:` — the property that lets an agent cite without a second lookup, and one
//           the acceptance suite has already proved holds for all 6,098 files. Here we prove a
//           consumer can actually reach it and reproduce it verbatim.
//   CHECK4  The jurisdiction trap. Under NCC 2022 a Class 2 building in Tasmania is governed by
//           Section J of BCA 2019 Amendment 1, and the ONLY record of that in the corpus is a
//           blockquote on the Part J pages: `ls corpus/2022/*/j*-tas-*` returns nothing. An agent
//           that answers from the clause files alone gets it wrong with nothing to warn it, so
//           this measures whether the AGENTS.md route is followable by someone who has only just
//           read it.
//   CHECK5  `building_classes_excluded:` is read in the right direction. The key lists the
//           classes the clause does NOT apply to; read as "applies to" it yields the opposite of
//           the law. A6G3 "Class 2 buildings" excludes every class except Class 2.
//   ANSWER  One question that needs several of the above at once, answered with a citation:
//           C3D10 for a Class 2 building in Victoria — found via CHECK1's phrase, disambiguated
//           by volume, cited from frontmatter, class-scoped via the inverted key, and checked for
//           a state variation.
//
// The verification is only honest if the agent cannot answer from anywhere else, so the agent is
// built with `web_search` and `web_fetch` DISABLED (and `write`/`edit` too — this is read-only).
// An agent with web access could produce a correct-looking answer having never opened the corpus.
//
// GRADING IS MECHANICAL AND SO IS READING IT. Each task must end in a RESULT LINE in a fixed
// `CHECKn key=value` shape, so the same transcript is checkable by `evaluateTranscript()` and by
// a human reading `.cache/verify-agent-transcript.md`. Several checks additionally require the
// corpus's own bytes to appear in the transcript (the `citation:` line, the Tasmanian blockquote,
// the `building_classes_excluded:` line) — a paraphrase fails, which is what stops the agent from
// grading itself on its own summary.
//
// OPERATOR STEP, NOT CI. It costs real tokens and needs two credentials, so it refuses to run
// without them, names exactly which are missing, and never prints either one. `--dry-run` shows
// the whole plan — prompt included — with no credentials and no network.
//
// API CONTRACT. Managed Agents, beta `managed-agents-2026-04-01`, raw HTTP over global fetch
// (this repository has exactly one runtime dependency and it is not an SDK). Shapes are taken
// from the `claude-api` skill's managed-agents reference, not from memory: agent-then-session is
// mandatory and `model`/`system`/`tools` live on the AGENT; a session takes a pointer to it plus
// `environment_id`, `resources[]` and `initial_events[]`; a non-empty `initial_events` starts the
// session in `running` without a second call; `GET /v1/sessions/{id}/events` is a plain paginated
// GET (`page`/`next_page`), not a long poll; and a session is finished when the last
// `session.status_*` event is `terminated`, or `idle` with a `stop_reason` other than
// `requires_action` — bare idle is NOT the gate.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/* ============================================================================
 * Constants
 * ========================================================================= */

export const API_ORIGIN = 'https://api.anthropic.com';
export const API_VERSION = '2023-06-01';
export const BETA_HEADER = 'managed-agents-2026-04-01';
export const USER_AGENT = 'aec-assistant-ncc-data/verify-agent (corpus consumer verification)';

export const REPO_URL = 'https://github.com/vove-ai/aec-assistant-ncc-data';
export const REPO_SLUG = 'vove-ai/aec-assistant-ncc-data';
export const MOUNT_PATH = '/workspace/aec-assistant-ncc-data';
export const DEFAULT_BRANCH = 'main';

export const AGENT_NAME = 'ncc-corpus-verify';
export const ENVIRONMENT_NAME = 'ncc-corpus-verify';

// The plan names Sonnet 5 for this task and it is more than enough to run greps and read
// frontmatter. (The `claude-api` skill's standing default is `claude-opus-5`; override with
// VERIFY_AGENT_MODEL if you want to grade a different model against the same corpus.)
export const DEFAULT_MODEL = 'claude-sonnet-5';

export const CACHE_DIR = '.cache';
export const CACHE_FILE = `${CACHE_DIR}/verify-agent.json`;
export const EVENTS_FILE = `${CACHE_DIR}/verify-agent-events.json`;
export const TRANSCRIPT_FILE = `${CACHE_DIR}/verify-agent-transcript.md`;

export const POLL_INTERVAL_MS = 10_000;   // 6/min against a 600 RPM endpoint limit
export const OVERALL_CAP_MS = 15 * 60_000;
export const REQUEST_TIMEOUT_MS = 60_000;
export const MAX_EVENT_PAGES = 20;

export const USAGE = `usage: node tools/src/verify-agent.mjs [--dry-run] [--no-github-token] [--keep-session]

  (no flags)          run the verification. Needs ANTHROPIC_API_KEY and GITHUB_TOKEN.
  --dry-run           print the plan, the full prompt and the redacted request bodies, then stop.
                      No credentials, no network, no writes.
  --no-github-token   omit authorization_token from the github_repository resource. The documented
                      contract marks that field REQUIRED even though this repository is public, so
                      this flag is an experiment that may be rejected by the API — see the report.
  --keep-session      do not archive the session at the end (post-mortem in the Console).

env: VERIFY_AGENT_MODEL, VERIFY_AGENT_EFFORT, VERIFY_AGENT_BRANCH, VERIFY_AGENT_WORKSPACE,
     VERIFY_AGENT_POLL_MS, VERIFY_AGENT_CAP_MS, ANTHROPIC_BASE_URL`;

/* ============================================================================
 * Secrets
 *
 * Two credentials pass through this file and neither may ever reach stdout, a cache file, an
 * error message or a request echo. `redact()` is the single chokepoint: every structure that is
 * printed or written goes through it, so a new secret-bearing field is masked by adding its name
 * here rather than by remembering to mask it at each print site.
 * ========================================================================= */

export const SECRET_KEYS = new Set([
  'authorization_token', 'authorization', 'x-api-key', 'api_key', 'apiKey', 'token', 'secret_value',
]);
export const REDACTED = '[redacted]';

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.has(k) ? REDACTED : redact(v);
    return out;
  }
  return value;
}

/**
 * Refuse before doing anything, and say exactly what is missing and what it has to be. The
 * message quotes variable NAMES only — never a value, not even a prefix, because a truncated key
 * in a terminal scrollback is still a leak.
 */
export function requireCredentials(env = {}, { githubToken: needGithub = true } = {}) {
  const apiKey = String(env.ANTHROPIC_API_KEY ?? '').trim();
  const githubToken = String(env.GITHUB_TOKEN ?? '').trim();
  const missing = [];
  if (!apiKey) {
    missing.push('ANTHROPIC_API_KEY — an Anthropic API key for a workspace that can create agents, '
      + 'environments and sessions (Managed Agents beta).');
  }
  if (needGithub && !githubToken) {
    missing.push(`GITHUB_TOKEN — a fine-grained GitHub PAT with "Contents: Read" on ${REPO_SLUG}. `
      + 'It is used only as the session resource\'s authorization_token; it is never placed inside '
      + 'the container. If you want to test whether a public repository needs one at all, re-run '
      + 'with --no-github-token.');
  }
  if (missing.length) {
    throw new Error(`verify-agent: refusing to run — ${missing.length} credential(s) missing from the `
      + `environment.\n\n  ${missing.join('\n\n  ')}\n\n`
      + 'Nothing was created and no request was made. Run with --dry-run to see the whole plan '
      + 'without credentials.');
  }
  return { apiKey, githubToken: needGithub ? githubToken : '' };
}

/* ============================================================================
 * The six checks
 *
 * One table, two consumers: `buildPrompt()` renders it into the agent's instructions and
 * `evaluateTranscript()` grades the transcript against it. They cannot drift, because a check
 * that is not in this table is neither asked for nor graded.
 *
 * Every `expect` is written against MEASURED values (`grep -rl … | wc -l` over the committed
 * corpus, 2026-08). If the corpus changes, these numbers change with it and this file is part of
 * the diff — that is the intended coupling, not an accident.
 * ========================================================================= */

const eq = (fields, key, want, problems) => {
  const got = fields[key];
  if (got === undefined) problems.push(`${key}= is missing from the result line`);
  else if (got !== want) problems.push(`${key}=${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
};
const matches = (fields, key, re, describe, problems) => {
  const got = fields[key];
  if (got === undefined) problems.push(`${key}= is missing from the result line`);
  else if (!re.test(got)) problems.push(`${key}=${JSON.stringify(got)}, expected ${describe}`);
};
const transcriptHas = (transcript, re, describe, problems) => {
  if (!re.test(transcript)) {
    problems.push(`the transcript never reproduces ${describe} — the raw output was not pasted verbatim`);
  }
};

/**
 * Evidence patterns must match the CORPUS and not AGENTS.md.
 *
 * The prompt opens by telling the agent to `cat AGENTS.md`, and AGENTS.md documents this format by
 * showing it: its "Reading a hit" block contains a literal `citation: NCC 2025 V1 C2D2` line, a
 * `web_url: https://ncc.abcb.gov.au/…#C2D2` line and a `building_classes_excluded:` line, and its
 * traps section quotes the Tasmanian passage. A loose evidence regex is therefore satisfied by an
 * agent that read the documentation and never opened a corpus file — the one thing these checks
 * exist to rule out. Each pattern below is pinned to something the doc does NOT contain:
 *
 *   citation  — end-anchored, because AGENTS.md's line carries a trailing `# quote this` comment
 *   web_url   — the real `/editions/ncc-2025/…/volume-one/…` path, where the doc has an ellipsis
 *               (this also rejects the NCC 2022 URL for the same clause, `/editions/ncc-2022/…`)
 *   Tasmania  — the single-line form; AGENTS.md wraps that sentence across two `> ` lines
 *   A6G3      — its `Class 1a,Class 1b,Class 3,…` value; the doc's example line is C3D10's value,
 *               which is why ANSWER must never key on `building_classes_excluded:`
 *
 * `PREFIX` tolerates the `path:` and `12:` that grep prepends under -r and -n, and nothing else:
 * an unbounded leading wildcard would re-open the hole it is here to close.
 */
const PREFIX = '(?:corpus\\/\\S+\\.md[:-])?(?:\\d+[:-])?';
const nccUrl = (volume, anchor) =>
  `https:\\/\\/ncc\\.abcb\\.gov\\.au\\/editions\\/ncc-2025\\/\\S+\\/${volume}\\/\\S+#${anchor}`;
const frontmatterOf = (citation, anchor, volume = 'volume-one') => ({
  citationLine: new RegExp(`^[ \\t]*${PREFIX}citation: ${citation}[ \\t\\r]*$`, 'm'),
  webUrlLine: new RegExp(`^[ \\t]*${PREFIX}web_url: ${nccUrl(volume, anchor)}[ \\t\\r]*$`, 'm'),
  webUrlField: new RegExp(`^${nccUrl(volume, anchor)}$`),
});

const C2D2 = frontmatterOf('NCC 2025 V1 C2D2', 'C2D2');
const C3D10 = frontmatterOf('NCC 2025 V1 C3D10', 'C3D10');

export const CHECKS = [
  {
    id: 'CHECK1',
    title: 'the phrase-grep defect is fixed',
    proves: 'A human-typed phrase that the source XML splits across a cross-reference element '
      + 'matches on one line here: 17 files in corpus/2025/, 13 in corpus/2022/. This is the '
      + 'reason this repository exists.',
    task: `Count the files whose text contains this phrase, in each edition, and name the clause
whose own title is that phrase:

    cd ${MOUNT_PATH}
    grep -rl "resistance to the incipient spread of fire to the space above" corpus/2025/ | wc -l
    grep -rl "resistance to the incipient spread of fire to the space above" corpus/2022/ | wc -l
    grep -rl "resistance to the incipient spread of fire to the space above" corpus/2025/

Paste the third command's file list in full.`,
    format: 'CHECK1 ncc2025=<count> ncc2022=<count> clause=<designation>',
    expect(f, transcript) {
      const problems = [];
      eq(f, 'ncc2025', '17', problems);
      eq(f, 'ncc2022', '13', problems);
      eq(f, 'clause', 'A5G7', problems);
      transcriptHas(transcript,
        /^[ \t]*corpus\/2025\/volume-one\/a5g7-resistance-to-the-incipient-spread-of-fire\.md[ \t]*$/m,
        'the grep -rl file list (corpus/2025/volume-one/a5g7-….md)', problems);
      return problems;
    },
  },
  {
    id: 'CHECK2',
    title: 'clause-ID lookup lands, including the ambiguity',
    proves: 'A designation glob is the primary lookup, and C2D2 is deliberately two different '
      + 'clauses — Volume One and Volume Three — which an agent must tell apart by path and '
      + 'frontmatter rather than by taking the first hit.',
    task: `Look up clause C2D2 by glob in both editions, then read the frontmatter of both NCC 2025
files and say which volume each belongs to:

    ls corpus/2025/*/c2d2-*
    ls corpus/2022/*/c2d2-*
    grep -n "^C2D2 " corpus/2025/INDEX.md`,
    format: 'CHECK2 ncc2025=<file count> ncc2022=<file count> volone="<title>" volthree="<title>"',
    expect(f) {
      const problems = [];
      eq(f, 'ncc2025', '2', problems);
      eq(f, 'ncc2022', '2', problems);
      matches(f, 'volone', /^type of construction required$/i, '"Type of construction required"', problems);
      matches(f, 'volthree', /^invert levels$/i, '"Invert levels"', problems);
      return problems;
    },
  },
  {
    id: 'CHECK3',
    title: 'citation is self-contained',
    proves: 'citation: and web_url: are always inside a `grep -A6` window, so an agent can cite a '
      + 'clause from the same hit that answered the question, with no second lookup.',
    task: `Show that the citation and the authoritative URL are inside one grep window. Use the
**Volume One** C2D2 file you globbed in Task 2 — do not take its name from here:

    grep -A6 "^clause: C2D2$" <the Volume One C2D2 file>

Paste that output verbatim — the \`citation:\` and \`web_url:\` lines must appear in your message
exactly as the file has them, including the full URL.`,
    format: 'CHECK3 clause=C2D2 citation="<the citation: value>" web_url=<the web_url: value>',
    expect(f, transcript) {
      const problems = [];
      eq(f, 'clause', 'C2D2', problems);
      eq(f, 'citation', 'NCC 2025 V1 C2D2', problems);
      matches(f, 'web_url', C2D2.webUrlField,
        'the NCC 2025 Volume One ncc.abcb.gov.au URL ending in #C2D2', problems);
      transcriptHas(transcript, C2D2.citationLine,
        'the file\'s own `citation: NCC 2025 V1 C2D2` line', problems);
      transcriptHas(transcript, C2D2.webUrlLine,
        'the file\'s own `web_url:` line, with its real /editions/ncc-2025/ path', problems);
      return problems;
    },
  },
  {
    id: 'CHECK4',
    title: 'the jurisdiction trap',
    proves: 'A whole Part can be disapplied by a blockquote that carries no variation marker and '
      + 'lives in no state file. For Section J in Tasmania under NCC 2022 that blockquote is the '
      + 'only record in the corpus, so an agent answering from the clause files alone is wrong '
      + 'with nothing to warn it. AGENTS.md documents the route; this measures whether it works.',
    task: `Answer, from the corpus only: **under NCC 2022, for a Class 2 building in Tasmania, which
Section J governs?**

The clause files will not answer this. AGENTS.md tells you where to look. Show both halves:

  - that there is no Tasmanian Section J clause file — run \`ls corpus/2022/*/j*-tas-*\` and paste
    its output (a "No such file" error IS the result; report it, do not hide it);
  - the file that does record the Tasmanian position, and the blockquote itself pasted verbatim.

\`source=\` is the repo-relative path of the file you took the passage from, and \`governing=\` is the
instrument that passage names.`,
    format: 'CHECK4 tasclausefiles=<count> source=<repo-relative path> governing="<instrument>"',
    expect(f, transcript) {
      const problems = [];
      eq(f, 'tasclausefiles', '0', problems);
      matches(f, 'source', /^corpus\/2022\/volume-one\/part-j\d\S*\.md$/,
        'a corpus/2022/volume-one/part-j…md path', problems);
      matches(f, 'governing', /BCA 2019 Amendment 1/i, 'the instrument to name "BCA 2019 Amendment 1"', problems);
      // Anchored to the corpus's single-line form: AGENTS.md quotes this same sentence, but wrapped
      // across two `> ` lines, so an unanchored match would accept a restatement of the docs.
      transcriptHas(transcript,
        /^[ \t]*>?[ \t]*In Tasmania, for a Class 2 building and Class 4 part of a building, Section J is replaced with Section J of BCA 2019 Amendment 1\./m,
        'the Tasmanian blockquote as one line, as the corpus file has it', problems);
      return problems;
    },
  },
  {
    id: 'CHECK5',
    title: 'building_classes_excluded: is read in the right direction',
    proves: 'The key lists the classes the clause does NOT apply to. Read as "applies to" it '
      + 'yields the exact opposite of the law, on 3,289 clause files.',
    task: `Read the class scope of A6G3 "Class 2 buildings":

    grep -n "^building_classes_excluded:" corpus/2025/volume-one/a6g3-class-2-buildings.md

Paste that line verbatim, then say — using what AGENTS.md says the key means — whether Class 2
appears in that list, whether the clause applies to a Class 1a building, and which classes it does
apply to.`,
    format: 'CHECK5 clause=A6G3 class2_in_excluded=<yes|no> class1a_applies=<yes|no> applies_to="<classes>"',
    expect(f, transcript) {
      const problems = [];
      eq(f, 'clause', 'A6G3', problems);
      eq(f, 'class2_in_excluded', 'no', problems);
      eq(f, 'class1a_applies', 'no', problems);
      matches(f, 'applies_to', /class 2/i, 'the answer to name Class 2', problems);
      // A6G3's value starts `Class 1a,Class 1b,Class 3,` — AGENTS.md's example line is a different
      // clause's value (`…,Class 10a,…`), so only the corpus file satisfies this.
      transcriptHas(transcript,
        new RegExp(`^[ \\t]*${PREFIX}building_classes_excluded: Class 1a,Class 1b,Class 3,`, 'm'),
        'the file\'s own `building_classes_excluded:` line', problems);
      return problems;
    },
  },
  {
    id: 'ANSWER',
    title: 'one question that needs several of these at once',
    proves: 'The corpus supports an actual compliance answer end to end: phrase → clause → volume '
      + '→ verbatim citation → class scope through the inverted key → jurisdiction check.',
    task: `Now answer one question. Use only this corpus.

  A Class 2 building in Victoria has sole-occupancy units above a Class 6 shop on the storey
  below. Under NCC 2025:

    (a) which Deemed-to-Satisfy clause governs the separation of those classifications in
        different storeys?
    (b) does it apply to a Class 2 building, and how do you know?
    (c) is there a Victorian variation of it — either a separate state file or an inline state
        block in the national file? Say which commands you ran to decide.
    (d) that clause requires a ceiling with a resistance to the incipient spread of fire. Which
        clause says when a ceiling is deemed to have one?

Write the answer as you would give it to an architect: quote \`citation:\` verbatim, link
\`web_url:\`, and name the edition. Paste that clause's own \`citation:\` and \`web_url:\` frontmatter
lines, as the file has them, alongside the answer.`,
    format: 'ANSWER clause=<designation> citation="<citation>" web_url=<url> '
      + 'class2_applies=<yes|no> vic_variation=<yes|no> risf_clause=<designation>',
    expect(f, transcript) {
      const problems = [];
      eq(f, 'clause', 'C3D10', problems);
      eq(f, 'citation', 'NCC 2025 V1 C3D10', problems);
      matches(f, 'web_url', C3D10.webUrlField,
        'the NCC 2025 Volume One ncc.abcb.gov.au URL ending in #C3D10', problems);
      eq(f, 'class2_applies', 'yes', problems);
      eq(f, 'vic_variation', 'no', problems);
      eq(f, 'risf_clause', 'A5G7', problems);
      // The capstone needs evidence too, or every field above is guessable, derivable from CHECK3,
      // or plausibly in training. Neither of these two lines appears in AGENTS.md — unlike C3D10's
      // `building_classes_excluded:` value, which is the doc's own example line and is therefore
      // deliberately NOT used here.
      transcriptHas(transcript, C3D10.citationLine,
        'the clause\'s own `citation: NCC 2025 V1 C3D10` line', problems);
      transcriptHas(transcript, C3D10.webUrlLine,
        'the clause\'s own `web_url:` line, with its real /editions/ncc-2025/ path', problems);
      return problems;
    },
  },
];

/* ============================================================================
 * Prompt
 * ========================================================================= */

export const AGENT_SYSTEM = `You verify data repositories from the outside, as a consumer of them.

You have no web access. Every statement you make must come from a command you ran against the
repository mounted in this session; if the repository cannot support a statement, say so instead of
supplying it from memory. Never retype command output from memory — paste it.

You are precise about instructions that specify an exact output format, because your reply is read
by a program as well as by a person.`;

/**
 * The instructions the session starts with. Deterministic: same bytes every run, no timestamps,
 * no environment. Rendered from CHECKS so the graded format and the asked-for format are one
 * string.
 */
export function buildPrompt(checks = CHECKS) {
  const tasks = checks.map((c, i) => `## Task ${i + 1} — ${c.title}

${c.task}

RESULT LINE:  ${c.format}`).join('\n\n');

  return `This repository is mounted at ${MOUNT_PATH}. Start here:

    cd ${MOUNT_PATH} && cat AGENTS.md

\`AGENTS.md\` is the search contract for this corpus: how the files are laid out, how to find a
clause, how to read a hit, and which traps change the answer. Read all of it before you run
anything else. \`corpus/\` is the National Construction Code of Australia as one markdown file per
unit, in two editions — \`corpus/2022/\` and \`corpus/2025/\` — and both are in force.

You have bash, read, glob and grep. You have no web access and you cannot write or edit files:
this is a read-only verification and every answer must come out of the mounted repository.

There are ${checks.length} tasks. For each one:

  1. run the commands with the bash tool;
  2. paste their raw output verbatim in a fenced code block — do not summarise it, reformat it,
     re-wrap it, truncate it, or retype it from memory. If a command fails or returns nothing,
     that output is still the result: paste it;
  3. print the task's RESULT LINE alone on its own line, in exactly the format given — no bold,
     no backticks, no surrounding prose. Any value containing a space is double-quoted, exactly
     as shown in the format.

Then end your final message with all ${checks.length} RESULT LINES copied together, so they can be
read at a glance.

Report what you actually find. If a count or a path differs from what you expected, say the number
you got — a wrong number here is a finding about the repository, and papering over it wastes the
run.

${tasks}`;
}

/* ============================================================================
 * Request bodies (pure — every field here is unit-tested)
 * ========================================================================= */

export function buildEnvironmentBody() {
  return {
    name: ENVIRONMENT_NAME,
    description: `Read-only verification of the ${REPO_SLUG} corpus.`,
    // The repository clone happens Anthropic-side before the agent runs, and the agent's own web
    // tools are disabled below, so egress policy is not the control that keeps this honest.
    // `unrestricted` is used because restricting it is not documented to be safe for the clone.
    config: { type: 'cloud', networking: { type: 'unrestricted' } },
  };
}

export function buildAgentBody({ model = DEFAULT_MODEL, effort = '' } = {}) {
  return {
    name: AGENT_NAME,
    // `model` is a bare string unless an effort level is asked for; the object form is the only
    // way to carry `effort`, and effort is agent configuration — setting it on a session is
    // silently ignored.
    model: effort ? { id: model, effort } : model,
    description: `Verifies the ${REPO_SLUG} corpus by grepping it. Read-only, no web access.`,
    system: AGENT_SYSTEM,
    tools: [
      {
        type: 'agent_toolset_20260401',
        default_config: { enabled: true },
        // web_search/web_fetch off is what makes the result mean something: with them on, a
        // correct-looking NCC answer proves nothing about this corpus. write/edit off keeps the
        // mounted checkout exactly as cloned.
        configs: [
          { name: 'write', enabled: false },
          { name: 'edit', enabled: false },
          { name: 'web_search', enabled: false },
          { name: 'web_fetch', enabled: false },
        ],
      },
    ],
  };
}

export function buildSessionBody({
  agentId, agentVersion = null, environmentId, githubToken = '', prompt = buildPrompt(),
  branch = DEFAULT_BRANCH, title = `Verify ${REPO_SLUG}`,
} = {}) {
  const repo = {
    type: 'github_repository',
    url: REPO_URL,
    mount_path: MOUNT_PATH,
    checkout: { type: 'branch', name: branch },
  };
  // Documented as required even for a public repository — omitted only under --no-github-token,
  // which exists to find out empirically whether that is enforced.
  if (githubToken) repo.authorization_token = githubToken;

  return {
    agent: agentVersion === null || agentVersion === undefined
      ? agentId
      : { type: 'agent', id: agentId, version: agentVersion },
    environment_id: environmentId,
    title,
    resources: [repo],
    // A non-empty initial_events starts the agent loop in the same call, so the session is
    // created directly in `running` — there is no separate send, and nothing to miss between
    // create and the first poll.
    initial_events: [{ type: 'user.message', content: [{ type: 'text', text: prompt }] }],
  };
}

/** Config drift detector: the cached agent is only reusable if it was made from these bytes. */
export function agentConfigHash(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16);
}

/** An agent's `model` comes back as a bare string or as an object; both mean the same thing. */
export function modelId(model) {
  if (typeof model === 'string') return model;
  if (model && typeof model === 'object' && typeof model.id === 'string') return model.id;
  return null;
}

/* ============================================================================
 * Transcript parsing and grading
 * ========================================================================= */

const RESULT_ID_RE = /^(CHECK\d+|ANSWER)\b/;
const FIELD_RE = /([A-Za-z_][A-Za-z0-9_]*)=("([^"]*)"|'([^']*)'|\S+)/g;

/** Strip the markdown a model wraps a line in, without touching the line's own content. */
function unwrap(line) {
  let s = String(line).trim();
  s = s.replace(/^[>\s]*/, '').trim();          // blockquote markers
  s = s.replace(/^[-*+]\s+/, '');               // list bullet
  s = s.replace(/^[`*_]+/, '').replace(/[`*_]+$/, '');
  return s.trim();
}

/** Trailing sentence punctuation is not part of a value; a leading grep line number is not either. */
function cleanValue(v) {
  return String(v).replace(/[`*_,;.\])]+$/, '').trim();
}

/**
 * Every RESULT LINE in the transcript, keyed by id. The last occurrence wins: models are asked to
 * repeat the lines in a closing block, and the closing block is the one they intend as final.
 *
 * A line that opens with a check id but carries no `key=value` is prose ("CHECK4 was the hard
 * one"), not a result, and is ignored — otherwise a sentence written after the real line would
 * clobber it under the last-wins rule and fail a run that had actually answered.
 */
export function parseResultLines(transcript = '') {
  const found = new Map();
  for (const raw of String(transcript).split(/\r?\n/)) {
    const line = unwrap(raw);
    const m = RESULT_ID_RE.exec(line);
    if (!m) continue;
    const id = m[1];
    const fields = {};
    for (const t of line.slice(id.length).matchAll(FIELD_RE)) {
      fields[t[1]] = cleanValue(t[3] ?? t[4] ?? t[2]);
    }
    if (Object.keys(fields).length === 0) continue;
    const prior = found.get(id);
    found.set(id, { id, line, fields, occurrences: (prior?.occurrences ?? 0) + 1 });
  }
  return found;
}

export function evaluateTranscript(transcript = '', checks = CHECKS) {
  const text = String(transcript);
  const parsed = parseResultLines(text);
  const results = checks.map(c => {
    const hit = parsed.get(c.id);
    if (!hit) {
      return {
        id: c.id, ok: false, line: null, occurrences: 0,
        reasons: [`no ${c.id} result line anywhere in the transcript (expected: ${c.format})`],
      };
    }
    const reasons = c.expect(hit.fields, text);
    return { id: c.id, ok: reasons.length === 0, line: hit.line, occurrences: hit.occurrences, reasons };
  });
  return { ok: results.every(r => r.ok), results };
}

/* ============================================================================
 * Event reading
 * ========================================================================= */

/**
 * What the agent SAID — `agent.message` text only, deliberately. Tool results the agent never
 * surfaced are not an answer: the property under test is that a consumer can reproduce the
 * corpus's content in its reply, so grading anything else would grade the wrong thing.
 */
export function collectTranscript(events = []) {
  const out = [];
  for (const ev of events) {
    if (ev?.type !== 'agent.message') continue;
    for (const block of ev.content ?? []) {
      if (block?.type === 'text' && typeof block.text === 'string') out.push(block.text);
    }
  }
  return out.join('\n\n');
}

/**
 * The finish gate. A session goes idle for reasons that are not "done", so `session.status_idle`
 * alone is never the test — `requires_action` means it is waiting on us, and since this harness
 * declares no custom tools and no always_ask policy, nothing can ever arrive to satisfy it. That
 * is a stall, and it is reported as one rather than waited out to the cap.
 */
export function sessionState(events = []) {
  let last = null;
  for (const ev of events) {
    if (typeof ev?.type === 'string' && ev.type.startsWith('session.status_')) last = ev;
  }
  if (!last) return { state: 'pending', done: false, why: 'no session.status_* event yet' };
  if (last.type === 'session.status_terminated') {
    return { state: 'terminated', done: true, why: 'session terminated' };
  }
  if (last.type === 'session.status_idle') {
    const stop = last.stop_reason?.type ?? 'unknown';
    if (stop === 'requires_action') {
      return {
        state: 'blocked', done: false, stopReason: stop,
        why: 'session is idle waiting for a client-side event (stop_reason requires_action). This '
          + 'harness declares no custom tools and no always_ask policy, so nothing will arrive to '
          + 'release it.',
      };
    }
    return { state: 'idle', done: true, stopReason: stop, why: `session idle (stop_reason ${stop})` };
  }
  return { state: last.type.replace('session.status_', ''), done: false, why: `session ${last.type}` };
}

export function summariseUsage(events = []) {
  const total = {
    calls: 0, input_tokens: 0, output_tokens: 0,
    cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
  };
  for (const ev of events) {
    if (ev?.type !== 'span.model_request_end') continue;
    total.calls += 1;
    const u = ev.model_usage ?? {};
    for (const k of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) {
      total[k] += Number(u[k]) || 0;
    }
  }
  return total;
}

/** A one-line-per-event digest for the progress log, so a run is legible while it happens. */
export function describeEvent(ev) {
  const t = ev?.type ?? '(no type)';
  if (t === 'agent.message') {
    const text = (ev.content ?? []).filter(b => b?.type === 'text').map(b => b.text).join(' ');
    return `agent.message   ${text.replace(/\s+/g, ' ').slice(0, 96)}${text.length > 96 ? '…' : ''}`;
  }
  if (t === 'agent.tool_use') return `agent.tool_use  ${ev.name ?? ''}`.trimEnd();
  if (t === 'session.status_idle') return `session.status_idle  stop_reason ${ev.stop_reason?.type ?? 'unknown'}`;
  if (t === 'session.error') return `session.error   ${ev.error?.message ?? JSON.stringify(ev.error ?? {})}`;
  return t;
}

export function consoleUrl(sessionId, workspace = 'default') {
  return `https://platform.claude.com/workspaces/${workspace}/sessions/${sessionId}`;
}

/* ============================================================================
 * Cache — create the agent and the environment once, then reuse them
 *
 * An agent cannot be deleted, only archived, so creating one per run would accumulate junk in the
 * workspace forever. `.cache/` is gitignored, and the file is small enough to read by hand.
 * ========================================================================= */

export function readCache(file = CACHE_FILE) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

export function writeCache(data, file = CACHE_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return data;
}

/**
 * Is the cached agent the one we would create now? A cached id whose model or config has moved on
 * would silently grade a different agent than the source says, so a mismatch is reported and the
 * agent is updated (a new version) rather than reused.
 */
export function agentReusable(cache, { model, configHash }) {
  const a = cache?.agent;
  if (!a?.id) return { reusable: false, reason: 'no cached agent id' };
  if (a.model !== model) {
    return { reusable: false, reason: `cached agent was created for model ${a.model ?? '(unknown)'}, this run wants ${model}` };
  }
  if (a.configHash !== configHash) {
    return { reusable: false, reason: 'the agent definition in verify-agent.mjs has changed since that agent was created' };
  }
  return { reusable: true, reason: 'cached agent matches this definition' };
}

/* ============================================================================
 * HTTP
 * ========================================================================= */

// 409 is deliberately absent: it is not transient, and it is the signal resolveEnvironment reads
// to adopt an environment that already exists under this name.
export const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);
export const MAX_RETRIES = 2;
export const defaultSleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * A run costs real money, so one transient blip must not throw it away — raw fetch gets none of an
 * SDK's backoff. But the retry is asymmetric on purpose:
 *
 *   GET  is idempotent. Retrying a 5xx or a dropped connection costs one more request.
 *   POST is not. A 5xx or a lost connection on `POST /v1/sessions` may mean the session WAS
 *        created and only the response went missing; retrying would start a second one and double
 *        what the run costs. So POST retries on 429 alone — a rate limit is a rejection before
 *        anything happened, and the API asks for the retry.
 *
 * `status === null` means fetch itself threw (network error or the wall-clock abort below).
 */
export function shouldRetry({ method, status = null, attempt, maxRetries = MAX_RETRIES }) {
  if (attempt >= maxRetries) return false;
  if (method === 'GET') return status === null || status >= 500 || RETRY_STATUSES.has(status);
  return status === 429;
}

export function retryDelayMs(attempt, retryAfter = null) {
  const secs = Number(retryAfter);
  if (Number.isFinite(secs) && secs > 0) return Math.min(secs, 60) * 1000;
  return 1000 * 2 ** attempt;
}

export async function apiRequest(pathname, {
  method = 'GET', body = null, apiKey, fetchImpl = fetch, origin = API_ORIGIN,
  timeoutMs = REQUEST_TIMEOUT_MS, maxRetries = MAX_RETRIES, sleep = defaultSleep, log = null,
} = {}) {
  if (!apiKey) throw new Error('verify-agent: apiRequest called without an API key');
  const url = `${origin}${pathname}`;
  const init = {
    method,
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION,
      'anthropic-beta': BETA_HEADER,
      'content-type': 'application/json',
      'user-agent': USER_AGENT,
    },
    body: body === null ? undefined : JSON.stringify(body),
  };

  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      // A wall-clock abort, because an HTTP client's timeout is per-chunk: a trickling response
      // can otherwise block a poll indefinitely without ever tripping it. Rebuilt each attempt —
      // a signal is single-use.
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      if (!shouldRetry({ method, status: null, attempt, maxRetries })) {
        // No body, no headers: the request carries the GitHub token and the API key.
        throw new Error(`verify-agent: ${method} ${pathname} → ${e.name === 'TimeoutError' ? `no response within ${timeoutMs}ms` : `network error (${e.name})`}`);
      }
      if (log) log(`    …${method} ${pathname} failed (${e.name}); retrying`);
      await sleep(retryDelayMs(attempt));
      continue;
    }

    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* reported raw below */ }
    if (res.ok) return json;

    if (shouldRetry({ method, status: res.status, attempt, maxRetries })) {
      const retryAfter = res.headers?.get?.('retry-after') ?? null;
      if (log) log(`    …${method} ${pathname} → HTTP ${res.status}; retrying`);
      await sleep(retryDelayMs(attempt, retryAfter));
      continue;
    }

    // The request body is NEVER included here — on session create it carries the GitHub token.
    const detail = json?.error ? `${json.error.type}: ${json.error.message}` : (text.slice(0, 400) || '(empty body)');
    const err = new Error(`verify-agent: ${method} ${pathname} → HTTP ${res.status} — ${detail}`
      + (json?.request_id ? ` [request_id ${json.request_id}]` : ''));
    err.status = res.status;
    err.body = json;
    throw err;
  }
}

/**
 * Follows the `page` → `next_page` cursor the managed-agents list endpoints document.
 *
 * Caveat, noted rather than guessed at: the skill is internally inconsistent about the ENVIRONMENTS
 * list specifically — the general pagination section gives `page`/`next_page`, while the
 * environments table gives `after_id`/`before_id`. Under the second scheme `page` is simply ignored
 * and `next_page` is absent, so this returns the first page and stops. That is correct behaviour
 * for its only caller (finding one environment by name among at most a handful) and would need the
 * other scheme only past 100 environments in one workspace.
 */
async function listAll(pathname, ctx, { limit = 100, cap = MAX_EVENT_PAGES } = {}) {
  const out = [];
  let page = null;
  for (let i = 0; i < cap; i++) {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (page) qs.set('page', page);
    const sep = pathname.includes('?') ? '&' : '?';
    const res = await apiRequest(`${pathname}${sep}${qs}`, ctx);
    out.push(...(res?.data ?? []));
    page = res?.next_page ?? null;
    if (!page) return { items: out, truncated: false };
  }
  return { items: out, truncated: true };
}

export async function listEvents(sessionId, ctx) {
  const { items, truncated } = await listAll(`/v1/sessions/${sessionId}/events`, ctx, { limit: 1000 });
  if (truncated) {
    throw new Error(`verify-agent: session ${sessionId} has more than ${MAX_EVENT_PAGES} pages of events — `
      + 'refusing to grade a transcript this tool knows is incomplete.');
  }
  return items;
}

/* ============================================================================
 * Resolve the two persistent resources
 * ========================================================================= */

async function findByName(pathname, name, ctx) {
  const { items } = await listAll(pathname, ctx, { limit: 100, cap: 10 });
  return items.find(x => x?.name === name) ?? null;
}

export async function resolveEnvironment(ctx, { cache, log }) {
  if (cache?.environment?.id) {
    log(`  environment  ${cache.environment.id}  (cached)`);
    return cache.environment;
  }
  const body = buildEnvironmentBody();
  try {
    const env = await apiRequest('/v1/environments', { ...ctx, method: 'POST', body });
    log(`  environment  ${env.id}  (created)`);
    return { id: env.id, name: ENVIRONMENT_NAME };
  } catch (e) {
    // Environment names are unique per workspace, so a 409 means one already exists under this
    // name — from a previous run whose cache was cleared. Adopt it rather than fail.
    if (e.status !== 409) throw e;
    const existing = await findByName('/v1/environments', ENVIRONMENT_NAME, ctx);
    if (!existing) {
      throw new Error(`verify-agent: creating environment "${ENVIRONMENT_NAME}" was rejected as a duplicate, `
        + 'but no environment of that name is listed. Resolve it in the Console and re-run.');
    }
    log(`  environment  ${existing.id}  (adopted — name already in use)`);
    return { id: existing.id, name: ENVIRONMENT_NAME };
  }
}

export async function resolveAgent(ctx, { cache, model, effort, log }) {
  const body = buildAgentBody({ model, effort });
  const configHash = agentConfigHash(body);
  const verdict = agentReusable(cache, { model, configHash });

  if (verdict.reusable) {
    log(`  agent        ${cache.agent.id} v${cache.agent.version}  (cached)`);
    return cache.agent;
  }

  // Cache miss with a live agent of this name means the cache was cleared, not that a second
  // agent is wanted: agents cannot be deleted, so creating a duplicate is permanent litter.
  // Only a 404 counts as "no such agent" — swallowing a 500 here would turn a transient blip
  // into a duplicate that can never be cleaned up.
  const existing = cache?.agent?.id
    ? await apiRequest(`/v1/agents/${cache.agent.id}`, ctx).catch(e => {
      if (e.status === 404) return null;
      throw e;
    })
    : await findByName('/v1/agents', AGENT_NAME, ctx);

  if (existing?.id) {
    log(`  agent        ${existing.id} — updating: ${verdict.reason}`);
    // No `version` in the body: this is a declarative apply of a checked-in definition, and this
    // tool owns the agent, so last-write-wins is the intended semantics rather than a 409 loop.
    const updated = await apiRequest(`/v1/agents/${existing.id}`, { ...ctx, method: 'POST', body });
    const agent = { id: updated.id, version: updated.version, model, configHash };
    log(`  agent        ${agent.id} v${agent.version}  (updated)`);
    return agent;
  }

  const created = await apiRequest('/v1/agents', { ...ctx, method: 'POST', body });
  const agent = { id: created.id, version: created.version, model, configHash };
  log(`  agent        ${agent.id} v${agent.version}  (created)`);
  return agent;
}

/* ============================================================================
 * CLI
 * ========================================================================= */

const FLAGS = new Set(['--dry-run', '--no-github-token', '--keep-session', '--help', '-h']);

export function parseArgs(argv = []) {
  const opts = { dryRun: false, noGithubToken: false, keepSession: false, help: false };
  for (const raw of argv) {
    const arg = String(raw);
    if (!FLAGS.has(arg)) {
      // Echo it only if it looks like a mistyped flag. This tool's arguments sit next to two
      // credentials on the command line, and a positionally-pasted key must not land in scrollback
      // (or in a CI log) just because it was in the wrong place.
      const safe = /^--?[A-Za-z0-9][A-Za-z0-9-]{0,31}$/.test(arg)
        ? JSON.stringify(arg)
        : `a ${arg.length}-character positional argument (not echoed — it may be a credential)`;
      throw new Error(`verify-agent: unknown argument ${safe}\n${USAGE}`);
    }
    if (arg === '--dry-run') opts.dryRun = true;
    if (arg === '--no-github-token') opts.noGithubToken = true;
    if (arg === '--keep-session') opts.keepSession = true;
    if (arg === '--help' || arg === '-h') opts.help = true;
  }
  return opts;
}

const intFromEnv = (env, key, fallback) => {
  const n = Number(env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export async function main(argv = [], {
  fetchImpl = fetch, env = process.env, sleep = defaultSleep, log = console.log,
  now = () => Date.now(), cacheFile = CACHE_FILE,
} = {}) {
  const opts = parseArgs(argv);
  if (opts.help) { log(USAGE); return; }

  const model = env.VERIFY_AGENT_MODEL || DEFAULT_MODEL;
  const effort = env.VERIFY_AGENT_EFFORT || '';
  const branch = env.VERIFY_AGENT_BRANCH || DEFAULT_BRANCH;
  const workspace = env.VERIFY_AGENT_WORKSPACE || 'default';
  const pollMs = intFromEnv(env, 'VERIFY_AGENT_POLL_MS', POLL_INTERVAL_MS);
  const capMs = intFromEnv(env, 'VERIFY_AGENT_CAP_MS', OVERALL_CAP_MS);
  const prompt = buildPrompt();

  log('verify-agent — verifies this corpus from the outside, as a Managed Agents session.\n');
  log(`  repository   ${REPO_SLUG} @ ${branch}  →  ${MOUNT_PATH}`);
  log(`  model        ${model}${effort ? `  (effort ${effort})` : ''}`);
  log(`  checks       ${CHECKS.map(c => c.id).join(', ')}`);
  log('');
  log('  This run will: create (or reuse) one agent and one environment, start ONE session with the');
  log(`  repository mounted, poll its events every ${Math.round(pollMs / 1000)}s for up to ${Math.round(capMs / 60000)} minutes, grade the`);
  log('  transcript, and archive the session. It spends real tokens — typically a few dozen model');
  log('  calls and single-digit dollars at most; the exact usage is reported at the end from the');
  log('  session\'s own span.model_request_end events.\n');

  if (opts.dryRun) {
    const status = k => (String(env[k] ?? '').trim() ? 'present' : 'MISSING');
    log(`  credentials  ANTHROPIC_API_KEY ${status('ANTHROPIC_API_KEY')}`
      + `   GITHUB_TOKEN ${opts.noGithubToken ? 'not required (--no-github-token)' : status('GITHUB_TOKEN')}`);
    log('\n--- POST /v1/environments ---');
    log(JSON.stringify(redact(buildEnvironmentBody()), null, 2));
    log('\n--- POST /v1/agents ---');
    log(JSON.stringify(redact(buildAgentBody({ model, effort })), null, 2));
    log('\n--- POST /v1/sessions ---');
    log(JSON.stringify(redact(buildSessionBody({
      agentId: '<agent id>', agentVersion: '<version>', environmentId: '<environment id>',
      githubToken: opts.noGithubToken ? '' : '<GITHUB_TOKEN>', prompt, branch,
    })), null, 2));
    log('\n--- the prompt, in full ---\n');
    log(prompt);
    log('\n(dry run — nothing was created, no request was made, no file was written.)');
    return;
  }

  const { apiKey, githubToken } = requireCredentials(env, { githubToken: !opts.noGithubToken });
  if (opts.noGithubToken) {
    log('  NOTE: --no-github-token — authorization_token is omitted from the github_repository');
    log('        resource. That field is documented as required; if the API rejects the session,');
    log('        that is the answer to whether a public repository needs one.\n');
  }

  const ctx = { apiKey, fetchImpl, origin: env.ANTHROPIC_BASE_URL || API_ORIGIN, sleep, log };
  const cache = readCache(cacheFile);

  const environment = await resolveEnvironment(ctx, { cache, log });
  const agent = await resolveAgent(ctx, { cache, model, effort, log });
  writeCache({ agent, environment }, cacheFile);

  const session = await apiRequest('/v1/sessions', {
    ...ctx,
    method: 'POST',
    body: buildSessionBody({
      agentId: agent.id, agentVersion: agent.version, environmentId: environment.id,
      githubToken, prompt, branch,
    }),
  });

  log(`  session      ${session.id}  (${session.status ?? 'created'})`);
  log(`\n  watch it:    ${consoleUrl(session.id, workspace)}`);
  log('               (if that 404s, the session is in a non-default workspace — set');
  log('                VERIFY_AGENT_WORKSPACE to its id, or use the Console\'s workspace search)\n');

  let events = [];
  let failure = null;
  try {
    const deadline = now() + capMs;
    const seen = new Set();
    for (;;) {
      events = await listEvents(session.id, ctx);
      for (const ev of events) {
        if (ev?.id && !seen.has(ev.id)) { seen.add(ev.id); log(`    ${describeEvent(ev)}`); }
      }
      const state = sessionState(events);
      if (state.done) { log(`\n  ${state.why}`); break; }
      if (state.state === 'blocked') throw new Error(`verify-agent: ${state.why}`);
      if (now() > deadline) {
        throw new Error(`verify-agent: gave up after ${Math.round(capMs / 60000)} minutes — the session was still `
          + `${state.state}. It is still in the Console: ${consoleUrl(session.id, workspace)}`);
      }
      await sleep(pollMs);
    }
  } catch (e) {
    failure = e;
  } finally {
    if (opts.keepSession) {
      log(`  session kept: ${consoleUrl(session.id, workspace)}`);
    } else {
      // The stream reports idle slightly before the session's queryable status catches up, so
      // archiving immediately can 400 with "cannot archive while running". Poll, then archive —
      // and never let a cleanup failure mask the real error.
      try {
        let status = null;
        for (let i = 0; i < 10; i++) {
          status = (await apiRequest(`/v1/sessions/${session.id}`, ctx))?.status ?? null;
          if (status !== 'running') break;
          await sleep(500);
        }
        // Still running after the poll: archiving would be rejected anyway, and a session that is
        // genuinely still working is not ours to cut off. Leave it and say where it is.
        if (status === 'running') {
          log(`  session still running after the settle poll — left alone: ${consoleUrl(session.id, workspace)}`);
        } else {
          await apiRequest(`/v1/sessions/${session.id}/archive`, { ...ctx, method: 'POST' });
          log('  session archived.');
        }
      } catch (e) {
        log(`  WARNING: could not archive session ${session.id} — ${e.message}`);
      }
    }
  }

  // Write the evidence before throwing anything: a failed run is exactly when the transcript is
  // worth reading.
  const transcript = collectTranscript(events);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(EVENTS_FILE, `${JSON.stringify(redact(events), null, 2)}\n`);
  fs.writeFileSync(TRANSCRIPT_FILE, `${transcript}\n`);
  log(`\n  ${events.length} events → ${EVENTS_FILE}`);
  log(`  transcript    → ${TRANSCRIPT_FILE}`);

  const usage = summariseUsage(events);
  log(`  model calls ${usage.calls}   in ${usage.input_tokens}   out ${usage.output_tokens}   `
    + `cache write ${usage.cache_creation_input_tokens}   cache read ${usage.cache_read_input_tokens}`);

  if (failure) throw failure;

  const { ok, results } = evaluateTranscript(transcript);
  log('');
  for (const r of results) {
    const check = CHECKS.find(c => c.id === r.id);
    log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.id}  ${check.title}`);
    if (r.line) log(`        ${r.line}`);
    for (const reason of r.reasons) log(`        ↳ ${reason}`);
  }

  const failed = results.filter(r => !r.ok);
  if (!ok) {
    throw new Error(`\nverify-agent: ${failed.length} of ${results.length} checks FAILED (${failed.map(r => r.id).join(', ')}).\n`
      + `Read ${TRANSCRIPT_FILE} — the raw command output the agent pasted says whether the corpus is\n`
      + 'wrong, the AGENTS.md route is unfollowable, or the agent simply did not follow the format.');
  }
  log(`\n  All ${results.length} checks passed: a Managed Agents session can mount this corpus and answer`);
  log('  an NCC question out of it, with a citation, without web access.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(e => { console.error(`\n${e.message}\n`); process.exit(1); });
}
