// verify-agent.test.mjs — the parts of the Managed Agents harness that can be tested without the
// network: request-body construction, the grading of a transcript, credential gating, and the
// agent/environment id cache.
//
// What is DELIBERATELY not here: any test that stands a fake API up and calls the result a test of
// the API. A hand-written fetch stub can only ever confirm this file's own beliefs about response
// shapes, so it would turn a wrong belief into a green test — the exact failure this repository
// keeps guarding against. The live contract is proved by the operator running it once.
//
// The two things a fake fetch IS used for are safety properties of the wiring, not of the API:
// that `main` refuses before it reaches the network, and that `--dry-run` never reaches it at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CHECKS, AGENT_NAME, ENVIRONMENT_NAME, DEFAULT_MODEL, MOUNT_PATH, REPO_URL, REPO_SLUG, REDACTED,
  buildPrompt, buildEnvironmentBody, buildAgentBody, buildSessionBody, agentConfigHash, modelId,
  redact, requireCredentials, parseResultLines, evaluateTranscript, collectTranscript,
  sessionState, summariseUsage, describeEvent, consoleUrl, readCache, writeCache, agentReusable,
  parseArgs, main,
} from '../src/verify-agent.mjs';

const API_KEY = 'sk-ant-THIS-MUST-NEVER-BE-PRINTED';
const GH_TOKEN = 'github_pat_THIS-MUST-NEVER-BE-PRINTED';

/* ---------------------------------------------------------------------------
 * A transcript that passes, assembled from the corpus's own bytes.
 *
 * The evidence block is not invented: those lines are what the files actually contain, and the
 * last test in this file re-derives every number in CHECKS from the committed corpus. So a
 * corpus change that invalidates what the operator is asked to verify fails here rather than in
 * the operator's hands.
 * ------------------------------------------------------------------------ */

const C2D2_URL = 'https://ncc.abcb.gov.au/editions/ncc-2025/adopted/volume-one/c-fire-resistance/part-c2-fire-resistance-and-stability#C2D2';
const C3D10_URL = 'https://ncc.abcb.gov.au/editions/ncc-2025/adopted/volume-one/c-fire-resistance/part-c3-compartmentation-and-separation#C3D10';

const PASS_LINES = {
  CHECK1: 'CHECK1 ncc2025=17 ncc2022=13 clause=A5G7',
  CHECK2: 'CHECK2 ncc2025=2 ncc2022=2 volone="Type of construction required" volthree="Invert levels"',
  CHECK3: `CHECK3 clause=C2D2 citation="NCC 2025 V1 C2D2" web_url=${C2D2_URL}`,
  CHECK4: 'CHECK4 tasclausefiles=0 source=corpus/2022/volume-one/part-j4-building-fabric.md '
    + 'governing="Section J of BCA 2019 Amendment 1"',
  CHECK5: 'CHECK5 clause=A6G3 class2_in_excluded=no class1a_applies=no applies_to="Class 2 buildings"',
  ANSWER: `ANSWER clause=C3D10 citation="NCC 2025 V1 C3D10" web_url=${C3D10_URL} `
    + 'class2_applies=yes vic_variation=no risf_clause=A5G7',
};

const EVIDENCE = {
  CHECK1: 'corpus/2025/volume-one/a5g7-resistance-to-the-incipient-spread-of-fire.md',
  CHECK3: `citation: NCC 2025 V1 C2D2\nweb_url: ${C2D2_URL}`,
  CHECK4: '> In Tasmania, for a Class 2 building and Class 4 part of a building, Section J is '
    + 'replaced with Section J of BCA 2019 Amendment 1.',
  CHECK5: 'building_classes_excluded: Class 1a,Class 1b,Class 3,Class 4,Class 5,Class 6,Class 7a,'
    + 'Class 7b,Class 8,Class 9a,Class 9b,Class 9c,Class 10a,Class 10b,Class 10c',
};

/** A passing transcript, with any result line replaced or any evidence line dropped. */
function transcript({ lines = {}, dropEvidence = [] } = {}) {
  const out = ['I read AGENTS.md, then ran the tasks.', '', '```'];
  for (const [id, text] of Object.entries(EVIDENCE)) {
    if (!dropEvidence.includes(id)) out.push(text);
  }
  out.push('```', '');
  for (const id of Object.keys(PASS_LINES)) {
    const line = Object.hasOwn(lines, id) ? lines[id] : PASS_LINES[id];
    if (line !== null) out.push(line);
  }
  return out.join('\n');
}

test('the assembled reference transcript passes every check', () => {
  const { ok, results } = evaluateTranscript(transcript());
  assert.deepEqual(results.filter(r => !r.ok).map(r => [r.id, r.reasons]), []);
  assert.equal(ok, true);
});

/* ---------------------------------------------------------------------------
 * Credential gating — the harness must not run without them, must say which are
 * missing, and must never print either value.
 * ------------------------------------------------------------------------ */

test('requireCredentials names BOTH missing variables, not just the first', () => {
  assert.throws(() => requireCredentials({}), e =>
    /ANTHROPIC_API_KEY/.test(e.message) && /GITHUB_TOKEN/.test(e.message) && /2 credential/.test(e.message));
});

test('requireCredentials names only the one that is missing', () => {
  assert.throws(() => requireCredentials({ ANTHROPIC_API_KEY: API_KEY }), e =>
    /GITHUB_TOKEN/.test(e.message) && !/ANTHROPIC_API_KEY —/.test(e.message));
  assert.throws(() => requireCredentials({ GITHUB_TOKEN: GH_TOKEN }), e =>
    /ANTHROPIC_API_KEY/.test(e.message) && !/GITHUB_TOKEN —/.test(e.message));
});

test('requireCredentials never puts a credential value in the error it throws', () => {
  // Both present-but-blank and one-present: neither path may echo what it read.
  for (const env of [{ ANTHROPIC_API_KEY: '   ', GITHUB_TOKEN: GH_TOKEN },
    { ANTHROPIC_API_KEY: API_KEY, GITHUB_TOKEN: '  ' }]) {
    try {
      requireCredentials(env);
      assert.fail('expected a refusal');
    } catch (e) {
      assert.ok(!e.message.includes(API_KEY), 'API key leaked into the error');
      assert.ok(!e.message.includes(GH_TOKEN), 'GitHub token leaked into the error');
    }
  }
});

test('requireCredentials trims and returns both, and drops GITHUB_TOKEN when it is not needed', () => {
  assert.deepEqual(requireCredentials({ ANTHROPIC_API_KEY: ` ${API_KEY} `, GITHUB_TOKEN: `${GH_TOKEN}\n` }),
    { apiKey: API_KEY, githubToken: GH_TOKEN });
  assert.deepEqual(requireCredentials({ ANTHROPIC_API_KEY: API_KEY }, { githubToken: false }),
    { apiKey: API_KEY, githubToken: '' });
});

test('requireCredentials points at --no-github-token rather than just demanding the token', () => {
  assert.throws(() => requireCredentials({ ANTHROPIC_API_KEY: API_KEY }), /--no-github-token/);
});

/* ---------------------------------------------------------------------------
 * Redaction — one chokepoint, applied to everything printed or written.
 * ------------------------------------------------------------------------ */

test('redact masks a secret at any depth and leaves everything else alone', () => {
  const r = redact({
    keep: 'visible',
    resources: [{ type: 'github_repository', url: REPO_URL, authorization_token: GH_TOKEN }],
    nested: { deep: { token: GH_TOKEN, count: 3 } },
  });
  assert.equal(r.keep, 'visible');
  assert.equal(r.resources[0].authorization_token, REDACTED);
  assert.equal(r.resources[0].url, REPO_URL);
  assert.equal(r.nested.deep.token, REDACTED);
  assert.equal(r.nested.deep.count, 3);
});

test('a redacted session body serialises with no trace of the token', () => {
  const body = buildSessionBody({ agentId: 'agent_1', environmentId: 'env_1', githubToken: GH_TOKEN });
  assert.ok(JSON.stringify(body).includes(GH_TOKEN), 'the real body must carry it');
  assert.ok(!JSON.stringify(redact(body)).includes(GH_TOKEN), 'the redacted body must not');
});

/* ---------------------------------------------------------------------------
 * Request bodies
 * ------------------------------------------------------------------------ */

test('the environment is a cloud container with unrestricted networking', () => {
  assert.deepEqual(buildEnvironmentBody().config, { type: 'cloud', networking: { type: 'unrestricted' } });
  assert.equal(buildEnvironmentBody().name, ENVIRONMENT_NAME);
});

test('the agent carries model/system/tools — the fields that may not go on a session', () => {
  const a = buildAgentBody();
  assert.equal(a.name, AGENT_NAME);
  assert.equal(a.model, DEFAULT_MODEL);
  assert.ok(a.system.length > 0);
  assert.equal(a.tools[0].type, 'agent_toolset_20260401');
});

test('web_search and web_fetch are OFF — with them on, a right answer proves nothing about the corpus', () => {
  const configs = buildAgentBody().tools[0].configs;
  const off = new Set(configs.filter(c => c.enabled === false).map(c => c.name));
  assert.ok(off.has('web_search') && off.has('web_fetch'), 'the agent must have no way to look the answer up');
  assert.ok(off.has('write') && off.has('edit'), 'the mounted checkout must be read-only');
  assert.equal(buildAgentBody().tools[0].default_config.enabled, true, 'bash/read/glob/grep stay enabled');
});

test('an effort level switches model to the object form, which is the only shape that carries it', () => {
  assert.equal(buildAgentBody({ model: 'claude-opus-5' }).model, 'claude-opus-5');
  assert.deepEqual(buildAgentBody({ model: 'claude-opus-5', effort: 'high' }).model,
    { id: 'claude-opus-5', effort: 'high' });
});

test('the session is a pointer to the agent plus the mount and the prompt', () => {
  const s = buildSessionBody({
    agentId: 'agent_1', agentVersion: 7, environmentId: 'env_1', githubToken: GH_TOKEN, branch: 'main',
  });
  assert.deepEqual(s.agent, { type: 'agent', id: 'agent_1', version: 7 });
  assert.equal(s.environment_id, 'env_1');
  for (const k of ['model', 'system', 'tools']) {
    assert.ok(!(k in s), `${k} belongs on the agent, never on the session`);
  }
  assert.deepEqual(s.resources, [{
    type: 'github_repository',
    url: REPO_URL,
    mount_path: MOUNT_PATH,
    checkout: { type: 'branch', name: 'main' },
    authorization_token: GH_TOKEN,
  }]);
  assert.equal(s.initial_events.length, 1);
  assert.equal(s.initial_events[0].type, 'user.message');
  assert.equal(s.initial_events[0].content[0].text, buildPrompt());
});

test('an omitted version means the agent string shorthand, not version undefined', () => {
  assert.equal(buildSessionBody({ agentId: 'agent_1', environmentId: 'env_1' }).agent, 'agent_1');
});

test('--no-github-token omits the field entirely rather than sending an empty one', () => {
  const repo = buildSessionBody({ agentId: 'a', environmentId: 'e', githubToken: '' }).resources[0];
  assert.ok(!('authorization_token' in repo));
});

test('agentConfigHash is stable for the same definition and moves when the definition does', () => {
  assert.equal(agentConfigHash(buildAgentBody()), agentConfigHash(buildAgentBody()));
  assert.notEqual(agentConfigHash(buildAgentBody()), agentConfigHash(buildAgentBody({ model: 'claude-opus-5' })));
  const tweaked = buildAgentBody();
  tweaked.system += ' ';
  assert.notEqual(agentConfigHash(buildAgentBody()), agentConfigHash(tweaked));
});

test('modelId reads both the string and the object form the API may echo', () => {
  assert.equal(modelId('claude-sonnet-5'), 'claude-sonnet-5');
  assert.equal(modelId({ id: 'claude-sonnet-5', effort: { type: 'high' } }), 'claude-sonnet-5');
  assert.equal(modelId(null), null);
  assert.equal(modelId({}), null);
});

/* ---------------------------------------------------------------------------
 * The prompt
 * ------------------------------------------------------------------------ */

test('the prompt asks for exactly the checks that are graded, in the format that is graded', () => {
  const p = buildPrompt();
  for (const c of CHECKS) {
    assert.ok(p.includes(c.format), `${c.id}: the graded format must be the asked-for format`);
    assert.ok(p.includes(c.title), `${c.id}: title missing from the prompt`);
  }
});

test('the prompt is deterministic — no timestamp, no environment, same bytes every run', () => {
  assert.equal(buildPrompt(), buildPrompt());
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(buildPrompt()), 'no ISO timestamp');
});

test('the prompt sends the agent to AGENTS.md, at the mount path, read-only', () => {
  const p = buildPrompt();
  assert.ok(p.includes(MOUNT_PATH));
  assert.ok(p.includes('AGENTS.md'));
  assert.ok(/no web access/i.test(p));
  assert.ok(/verbatim/i.test(p));
});

/* ---------------------------------------------------------------------------
 * Result-line parsing — a model will wrap these in markdown; the parser must not
 * be the reason a correct run fails.
 * ------------------------------------------------------------------------ */

test('parseResultLines reads a bare line', () => {
  const f = parseResultLines('CHECK1 ncc2025=17 ncc2022=13 clause=A5G7').get('CHECK1').fields;
  assert.deepEqual(f, { ncc2025: '17', ncc2022: '13', clause: 'A5G7' });
});

test('parseResultLines survives backticks, bold, bullets and blockquote markers', () => {
  for (const wrapped of ['`CHECK1 ncc2025=17 ncc2022=13 clause=A5G7`',
    '**CHECK1 ncc2025=17 ncc2022=13 clause=A5G7**',
    '- CHECK1 ncc2025=17 ncc2022=13 clause=A5G7',
    '> CHECK1 ncc2025=17 ncc2022=13 clause=A5G7',
    '   CHECK1 ncc2025=17 ncc2022=13 clause=A5G7   ']) {
    const hit = parseResultLines(wrapped).get('CHECK1');
    assert.ok(hit, `not parsed: ${wrapped}`);
    assert.equal(hit.fields.clause, 'A5G7', wrapped);
  }
});

test('parseResultLines keeps quoted values whole and strips trailing sentence punctuation', () => {
  const f = parseResultLines('CHECK2 ncc2025=2 volone="Type of construction required" clause=A5G7.').get('CHECK2').fields;
  assert.equal(f.volone, 'Type of construction required');
  assert.equal(f.clause, 'A5G7');
});

test('parseResultLines takes the LAST occurrence — models are asked to repeat the lines at the end', () => {
  const hit = parseResultLines('CHECK1 ncc2025=0 ncc2022=0 clause=X\n…\nCHECK1 ncc2025=17 ncc2022=13 clause=A5G7').get('CHECK1');
  assert.equal(hit.fields.ncc2025, '17');
  assert.equal(hit.occurrences, 2);
});

test('parseResultLines ignores prose, and prose after a result line does not clobber it', () => {
  const parsed = parseResultLines([
    'I will now do CHECK1 and report on it.',
    'CHECK4 tasclausefiles=0 source=corpus/2022/volume-one/part-j4-building-fabric.md governing="x"',
    'CHECK4 was the hardest of these, because the clause files do not answer it.',
  ].join('\n'));
  assert.equal(parsed.has('CHECK1'), false, 'a mid-sentence mention is not a result line');
  assert.equal(parsed.get('CHECK4').fields.tasclausefiles, '0', 'a fieldless sentence must not win last-wins');
  assert.equal(parsed.get('CHECK4').occurrences, 1);
});

/* ---------------------------------------------------------------------------
 * Grading — every check must fail on its own, for a stated reason.
 * ------------------------------------------------------------------------ */

const only = (results, id) => results.find(r => r.id === id);

test('a missing result line fails that check and only that check', () => {
  for (const id of Object.keys(PASS_LINES)) {
    const { results } = evaluateTranscript(transcript({ lines: { [id]: null } }));
    assert.equal(only(results, id).ok, false, `${id} should fail when absent`);
    assert.match(only(results, id).reasons[0], new RegExp(`no ${id} result line`));
    for (const other of results.filter(r => r.id !== id)) {
      assert.equal(other.ok, true, `${other.id} must not fail because ${id} is missing`);
    }
  }
});

test('a wrong value fails its own check, and the reason names the field and both values', () => {
  const cases = [
    ['CHECK1', 'CHECK1 ncc2025=0 ncc2022=13 clause=A5G7', /ncc2025="0", expected "17"/],
    ['CHECK1', 'CHECK1 ncc2025=17 ncc2022=13 clause=C2D2', /clause="C2D2", expected "A5G7"/],
    ['CHECK2', 'CHECK2 ncc2025=1 ncc2022=2 volone="Type of construction required" volthree="Invert levels"', /ncc2025="1"/],
    ['CHECK2', 'CHECK2 ncc2025=2 ncc2022=2 volone="Invert levels" volthree="Invert levels"', /volone/],
    ['CHECK3', `CHECK3 clause=C2D2 citation="NCC 2025 V1 C2D2 (VIC)" web_url=${C2D2_URL}`, /citation/],
    ['CHECK3', 'CHECK3 clause=C2D2 citation="NCC 2025 V1 C2D2" web_url=https://example.com/x#C2D2', /web_url/],
    ['CHECK4', 'CHECK4 tasclausefiles=1 source=corpus/2022/volume-one/part-j4-building-fabric.md governing="BCA 2019 Amendment 1"', /tasclausefiles/],
    ['CHECK4', 'CHECK4 tasclausefiles=0 source=corpus/2022/volume-one/j4d3-thermal-construction.md governing="BCA 2019 Amendment 1"', /source/],
    ['CHECK5', 'CHECK5 clause=A6G3 class2_in_excluded=yes class1a_applies=no applies_to="Class 2"', /class2_in_excluded/],
    ['CHECK5', 'CHECK5 clause=A6G3 class2_in_excluded=no class1a_applies=yes applies_to="Class 2"', /class1a_applies/],
    ['ANSWER', `ANSWER clause=C3D10 citation="NCC 2025 V1 C3D10" web_url=${C3D10_URL} class2_applies=no vic_variation=no risf_clause=A5G7`, /class2_applies/],
    ['ANSWER', `ANSWER clause=C2D2 citation="NCC 2025 V1 C3D10" web_url=${C3D10_URL} class2_applies=yes vic_variation=no risf_clause=A5G7`, /clause/],
  ];
  for (const [id, line, reason] of cases) {
    const { ok, results } = evaluateTranscript(transcript({ lines: { [id]: line } }));
    assert.equal(ok, false, `${line} should not pass`);
    assert.equal(only(results, id).ok, false, `${id} should be the failing check for: ${line}`);
    assert.ok(only(results, id).reasons.some(r => reason.test(r)),
      `${id} reasons ${JSON.stringify(only(results, id).reasons)} should match ${reason}`);
  }
});

test('the inverted-key trap fails in the direction it actually misleads', () => {
  // "building_classes_excluded lists Class 1a…" read as "applies to" gives exactly this answer:
  // A6G3 does not apply to Class 2 and does apply to Class 1a. Both must fail.
  const { results } = evaluateTranscript(transcript({
    lines: { CHECK5: 'CHECK5 clause=A6G3 class2_in_excluded=yes class1a_applies=yes applies_to="Class 1a, Class 1b, Class 3"' },
  }));
  assert.equal(only(results, 'CHECK5').ok, false);
  assert.equal(only(results, 'CHECK5').reasons.length, 3, 'both booleans and applies_to are wrong');
});

test('a paraphrased answer fails: each evidence check needs the corpus\'s own bytes in the transcript', () => {
  for (const [id, expected] of [
    ['CHECK1', /grep -rl file list/],
    ['CHECK3', /citation: NCC 2025 V1 C2D2/],
    ['CHECK4', /Tasmanian blockquote/],
    ['CHECK5', /building_classes_excluded/],
  ]) {
    const { results } = evaluateTranscript(transcript({ dropEvidence: [id] }));
    assert.equal(only(results, id).ok, false, `${id} passed without the raw output`);
    assert.ok(only(results, id).reasons.some(r => expected.test(r) && /verbatim/.test(r)),
      `${id} reasons ${JSON.stringify(only(results, id).reasons)}`);
  }
});

test('an empty transcript fails everything, and says so once per check', () => {
  const { ok, results } = evaluateTranscript('');
  assert.equal(ok, false);
  assert.equal(results.length, CHECKS.length);
  assert.ok(results.every(r => !r.ok && r.reasons.length === 1));
});

/* ---------------------------------------------------------------------------
 * Event reading
 * ------------------------------------------------------------------------ */

const say = text => ({ id: `e${text.length}`, type: 'agent.message', content: [{ type: 'text', text }] });

test('the transcript is what the agent SAID — tool results it never surfaced are not an answer', () => {
  const events = [
    { type: 'agent.tool_use', name: 'bash', input: { command: 'grep …' } },
    { type: 'agent.tool_result', content: [{ type: 'text', text: 'CHECK1 ncc2025=17 ncc2022=13 clause=A5G7' }] },
    say('first'),
    { type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
    say('second'),
  ];
  assert.equal(collectTranscript(events), 'first\n\nsecond');
  assert.equal(collectTranscript([]), '');
});

test('sessionState: idle alone is not the finish gate', () => {
  assert.equal(sessionState([]).state, 'pending');
  assert.equal(sessionState([{ type: 'session.status_running' }]).done, false);

  const blocked = sessionState([{ type: 'session.status_idle', stop_reason: { type: 'requires_action' } }]);
  assert.equal(blocked.state, 'blocked');
  assert.equal(blocked.done, false, 'requires_action means it is waiting on us — never a finish');

  const idle = sessionState([{ type: 'session.status_idle', stop_reason: { type: 'end_turn' } }]);
  assert.equal(idle.done, true);
  assert.equal(idle.stopReason, 'end_turn');

  assert.equal(sessionState([{ type: 'session.status_terminated' }]).done, true);
  assert.equal(sessionState([{ type: 'session.status_idle', stop_reason: { type: 'retries_exhausted' } }]).done, true);
});

test('sessionState reads the LAST status event, not the first', () => {
  const events = [
    { type: 'session.status_idle', stop_reason: { type: 'requires_action' } },
    { type: 'agent.message', content: [] },
    { type: 'session.status_running' },
    { type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
  ];
  assert.equal(sessionState(events).done, true);
  assert.equal(sessionState(events.slice(0, 3)).done, false);
});

test('summariseUsage adds up the model calls and tolerates a missing usage block', () => {
  const u = summariseUsage([
    { type: 'span.model_request_end', model_usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 5 } },
    { type: 'span.model_request_end', model_usage: { input_tokens: 7, output_tokens: 3, cache_creation_input_tokens: 1 } },
    { type: 'span.model_request_end' },
    { type: 'agent.message', content: [] },
  ]);
  assert.deepEqual(u, {
    calls: 3, input_tokens: 17, output_tokens: 5,
    cache_creation_input_tokens: 1, cache_read_input_tokens: 5,
  });
});

test('describeEvent gives one readable line per event kind', () => {
  assert.match(describeEvent(say('hello there')), /^agent\.message\s+hello there$/);
  assert.equal(describeEvent({ type: 'agent.tool_use', name: 'bash' }), 'agent.tool_use  bash');
  assert.match(describeEvent({ type: 'session.status_idle', stop_reason: { type: 'end_turn' } }), /end_turn/);
  assert.match(describeEvent({ type: 'session.error', error: { message: 'boom' } }), /boom/);
  assert.equal(describeEvent({ type: 'span.model_request_start' }), 'span.model_request_start');
});

test('consoleUrl points at the workspace the key belongs to', () => {
  assert.equal(consoleUrl('sesn_1'), 'https://platform.claude.com/workspaces/default/sessions/sesn_1');
  assert.equal(consoleUrl('sesn_1', 'wrkspc_9'), 'https://platform.claude.com/workspaces/wrkspc_9/sessions/sesn_1');
});

/* ---------------------------------------------------------------------------
 * The id cache — an agent cannot be deleted, so creating one per run is permanent litter.
 * ------------------------------------------------------------------------ */

test('the cache round-trips, and a missing or corrupt file reads as no cache', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-agent-'));
  const file = path.join(dir, 'nested', 'verify-agent.json');
  assert.equal(readCache(file), null);

  const data = { agent: { id: 'agent_1', version: 3, model: DEFAULT_MODEL, configHash: 'abc' }, environment: { id: 'env_1' } };
  writeCache(data, file);
  assert.deepEqual(readCache(file), data);
  assert.ok(fs.readFileSync(file, 'utf8').endsWith('\n'));

  fs.writeFileSync(file, '{not json');
  assert.equal(readCache(file), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('agentReusable refuses a cached agent whose model or definition has moved on', () => {
  const hash = agentConfigHash(buildAgentBody());
  const cache = { agent: { id: 'agent_1', version: 1, model: DEFAULT_MODEL, configHash: hash } };

  assert.equal(agentReusable(cache, { model: DEFAULT_MODEL, configHash: hash }).reusable, true);
  assert.match(agentReusable(cache, { model: 'claude-opus-5', configHash: hash }).reason, /created for model/);
  assert.equal(agentReusable(cache, { model: 'claude-opus-5', configHash: hash }).reusable, false);
  assert.match(agentReusable(cache, { model: DEFAULT_MODEL, configHash: 'other' }).reason, /definition .* has changed/);
  assert.equal(agentReusable(null, { model: DEFAULT_MODEL, configHash: hash }).reusable, false);
});

/* ---------------------------------------------------------------------------
 * CLI wiring — the two properties that live in main(), not in a helper.
 * ------------------------------------------------------------------------ */

test('parseArgs accepts the four flags and rejects anything else', () => {
  assert.deepEqual(parseArgs([]), { dryRun: false, noGithubToken: false, keepSession: false, help: false });
  assert.equal(parseArgs(['--dry-run']).dryRun, true);
  assert.equal(parseArgs(['--no-github-token']).noGithubToken, true);
  assert.equal(parseArgs(['--keep-session']).keepSession, true);
  assert.throws(() => parseArgs(['--upload']), /unknown argument "--upload"/);
});

test('main refuses without credentials BEFORE it touches the network', async () => {
  let calls = 0;
  const fetchImpl = () => { calls += 1; throw new Error('main must not reach the network'); };
  await assert.rejects(() => main([], { fetchImpl, env: {}, log: () => {} }), /ANTHROPIC_API_KEY/);
  assert.equal(calls, 0);
});

test('--no-github-token still requires the API key', async () => {
  await assert.rejects(
    () => main(['--no-github-token'], { fetchImpl: () => assert.fail('no network'), env: {}, log: () => {} }),
    e => /ANTHROPIC_API_KEY/.test(e.message) && !/GITHUB_TOKEN —/.test(e.message));
});

test('--dry-run prints the whole plan with no credentials, no network and no writes', async () => {
  const out = [];
  const before = readCache();
  await main(['--dry-run'], {
    fetchImpl: () => assert.fail('a dry run must not make a request'),
    env: { GITHUB_TOKEN: GH_TOKEN },
    log: (...a) => out.push(a.join(' ')),
  });
  const text = out.join('\n');
  assert.match(text, /ANTHROPIC_API_KEY MISSING/);
  assert.match(text, /POST \/v1\/sessions/);
  assert.ok(text.includes(buildPrompt()), 'the operator must be able to read the exact prompt');
  assert.ok(!text.includes(GH_TOKEN), 'a dry run must not echo the token it found in the environment');
  assert.match(text, new RegExp(REDACTED.replace(/[[\]]/g, '\\$&')));
  assert.deepEqual(readCache(), before, 'a dry run writes nothing');
});

/* ---------------------------------------------------------------------------
 * The numbers this harness asks the operator to verify are still true of the
 * committed corpus. Without this, a corpus change turns a passing verification
 * into a failing one in the operator's hands, with the harness at fault.
 * ------------------------------------------------------------------------ */

test('every measured expectation in CHECKS still holds for the committed corpus', () => {
  const files = ed => fs.readdirSync(`corpus/${ed}`, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .flatMap(d => fs.readdirSync(`corpus/${ed}/${d.name}`).map(f => `corpus/${ed}/${d.name}/${f}`));

  const PHRASE = 'resistance to the incipient spread of fire to the space above';
  const counts = {};
  for (const ed of ['2025', '2022']) {
    const all = files(ed);
    counts[ed] = {
      phrase: all.filter(p => fs.readFileSync(p, 'utf8').includes(PHRASE)).length,
      c2d2: all.filter(p => path.basename(p).startsWith('c2d2-')).length,
      tasClause: all.filter(p => /^j.*-tas-/.test(path.basename(p))).length,
    };
  }
  assert.equal(counts['2025'].phrase, 17, 'CHECK1 asks the agent for 17');
  assert.equal(counts['2022'].phrase, 13, 'CHECK1 asks the agent for 13');
  assert.equal(counts['2025'].c2d2, 2, 'CHECK2 asks the agent for 2');
  assert.equal(counts['2022'].c2d2, 2, 'CHECK2 asks the agent for 2');
  assert.equal(counts['2022'].tasClause, 0, 'CHECK4 asks the agent to find no Tasmanian Section J clause file');

  // The exact strings CHECK3/CHECK5/ANSWER require the agent to reproduce.
  const read = p => fs.readFileSync(p, 'utf8');
  const c2d2 = read('corpus/2025/volume-one/c2d2-type-of-construction-required.md');
  assert.match(c2d2, /^citation: NCC 2025 V1 C2D2$/m);
  assert.match(c2d2, /^web_url: https:\/\/ncc\.abcb\.gov\.au\/\S*#C2D2$/m);

  assert.match(read('corpus/2025/volume-one/a6g3-class-2-buildings.md'),
    /^building_classes_excluded: Class 1a,Class 1b,Class 3,/m);
  assert.match(read('corpus/2022/volume-one/part-j4-building-fabric.md'),
    /Section J is replaced with Section J of BCA 2019 Amendment 1/);

  const c3d10 = read('corpus/2025/volume-one/c3d10-separation-of-classifications-in-different-storeys.md');
  assert.match(c3d10, /^citation: NCC 2025 V1 C3D10$/m);
  assert.match(c3d10, /^web_url: https:\/\/ncc\.abcb\.gov\.au\/\S*#C3D10$/m);
  assert.ok(!/^building_classes_excluded:.*\bClass 2\b/m.test(c3d10),
    'ANSWER expects class2_applies=yes, i.e. Class 2 absent from the excluded list');
  assert.ok(/^building_classes_excluded:.*\bClass 1a\b/m.test(c3d10));
  assert.equal(files('2025').filter(p => path.basename(p).startsWith('c3d10-')).length, 1,
    'ANSWER expects vic_variation=no: exactly one C3D10 file, no state variation');
  assert.ok(!/variation \((REPLACE|INSERT|DELETE)\)/.test(c3d10), 'and no inline state block either');

  // And the reference transcript's evidence lines are the corpus's own bytes, not invented.
  assert.ok(c2d2.includes(EVIDENCE.CHECK3.split('\n')[0]));
  assert.ok(read('corpus/2025/volume-one/a6g3-class-2-buildings.md').includes(EVIDENCE.CHECK5));
  assert.ok(read('corpus/2022/volume-one/part-j4-building-fabric.md')
    .includes(EVIDENCE.CHECK4.replace(/^> /, '')));
});

test('the phrase CHECK1 uses is one line in the corpus — the whole reason this repository exists', () => {
  const file = 'corpus/2025/volume-one/a5g7-resistance-to-the-incipient-spread-of-fire.md';
  const hit = fs.readFileSync(file, 'utf8').split('\n')
    .filter(l => l.includes('resistance to the incipient spread of fire to the space above'));
  assert.ok(hit.length >= 1, 'the phrase must match on a single line, unsplit');
  assert.equal(REPO_SLUG, 'vove-ai/aec-assistant-ncc-data');
});
