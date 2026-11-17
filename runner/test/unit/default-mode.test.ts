// runner.json's defaults.permissionMode: the mode a thread that names none
// starts on (the phone, the website, tb new, schedules without one), and
// what hello tells the app's composer to start on. Unset is Full access, so
// an install from before it changes nothing; setup writes "auto" into a new
// install's runner.json (scripts/setup.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeHarness, testConfig, tmpDir } from '../helpers/fakes.ts';
import { loadConfig, writeRunnerJson } from '../../src/config.ts';
import { startOwnThread } from '../../src/own-threads.ts';

test('config: defaults.permissionMode is read from runner.json; unset, plan or nonsense is no default', () => {
  const home = tmpDir();
  assert.equal(loadConfig({ THREADBEAR_HOME: home }).defaults.permissionMode, undefined);
  for (const mode of ['full', 'ask', 'auto'] as const) {
    writeRunnerJson(home, { defaults: { permissionMode: mode } });
    assert.equal(loadConfig({ THREADBEAR_HOME: home }).defaults.permissionMode, mode);
  }
  // Plan first waits for Alex to approve a plan, so a thread nobody's
  // watching (a schedule, one from the phone) would just sit there.
  for (const bad of ['plan', 'yolo', 3]) {
    writeRunnerJson(home, { defaults: { permissionMode: bad as never } });
    assert.equal(loadConfig({ THREADBEAR_HOME: home }).defaults.permissionMode, undefined, String(bad));
  }
});

test('a thread that names no mode starts on the default; a named one wins', () => {
  const h = makeHarness(undefined, { defaults: { cwd: '', permissionMode: 'auto' } });
  h.cfg.defaults.cwd = path.join(h.home, 'work');
  assert.equal(h.runner.create({ text: 'hi' }).thread.permissionMode, 'auto');
  assert.equal(h.runner.create({ text: 'hi', origin: 'schedule', scheduleId: 'sc1' }).thread.permissionMode, 'auto', 'a schedule with no mode too');
  assert.equal(h.runner.create({ text: 'hi', permissionMode: 'full' }).thread.permissionMode, 'full');
  assert.equal(h.runner.create({ text: 'hi', permissionMode: 'ask' }).thread.permissionMode, 'ask');
  assert.equal(h.runner.hello().defaults.permissionMode, 'auto');
});

test('with no default, a thread that names no mode gets Full access, and hello says nothing', () => {
  const h = makeHarness();
  assert.equal(h.runner.create({ text: 'hi' }).thread.permissionMode, 'full');
  assert.equal(h.runner.hello().defaults.permissionMode, undefined);
  assert.ok(!('permissionMode' in h.runner.hello().defaults));
});

// Mike, 9 Nov 2026 (the security review's finding 8): the threads the
// runner starts by itself are handed words from upstream or a build log and
// run code nobody has read, so they get the install's own mode, not Full
// access whatever it is.
test("the runner's own threads start on the install's default mode", () => {
  for (const mode of ['auto', 'ask', 'full'] as const) {
    const home = tmpDir();
    const h = makeHarness(home, { ...testConfig(home), defaults: { cwd: path.join(home, 'work'), permissionMode: mode } });
    const notice = h.runner.noticeOnMac(undefined, 'A dialog', 'A dialog is waiting');
    assert.equal(h.runner.get(notice).permissionMode, mode, `the note about this Mac, on ${mode}`);
    // Bringing in Mike's release and fixing a failed update (main.ts) start
    // through this.
    const own = startOwnThread(h.runner, { text: 'Bring it in', title: "Bring in Mike's release", why: "Mike's new releases" }, path.join(home, 'work'));
    assert.equal(h.runner.get(own).permissionMode, mode, `a bring-in or update-fixer thread, on ${mode}`);
    assert.deepEqual(h.runner.get(own).startedBy, { kind: 'runner', label: 'Threadbear', why: "Mike's new releases" });
  }
  // An install from before 9 Nov has no default: Full access, as before.
  const h = makeHarness();
  assert.equal(h.runner.get(startOwnThread(h.runner, { text: 'x', title: 'x', why: 'x' }, undefined)).permissionMode, 'full');
  assert.equal(h.runner.get(h.runner.noticeOnMac(undefined, 'A dialog', 'x')).permissionMode, 'full');
});

// runner.json's defaults.folders (folder-defaults.ts): a folder's own mode
// over the overall one, for a repo whose Claude settings only load on Full
// access, without making Full the default everywhere (Florian, 17 Nov 2026).
test('config: defaults.folders is read with ~ expanded; entries without a usable mode are ignored', () => {
  const home = tmpDir();
  writeRunnerJson(home, { defaults: { permissionMode: 'auto', folders: { '~/code/repo': { permissionMode: 'full' }, '/x/plan': { permissionMode: 'plan' as never }, '/x/none': {}, '/x/junk': 3 as never } } });
  const cfg = loadConfig({ THREADBEAR_HOME: home, HOME: '/Users/alex' });
  assert.deepEqual(cfg.defaults.folders, { '/Users/alex/code/repo': { permissionMode: 'full' } });
  assert.equal(cfg.defaults.permissionMode, 'auto');
  writeRunnerJson(home, { defaults: { folders: { '/x': { permissionMode: 'plan' as never } } } });
  assert.ok(!('folders' in loadConfig({ THREADBEAR_HOME: home }).defaults));
});

test("a thread in a folder with its own mode starts on it, the longest folder winning; elsewhere the overall default; a named mode wins", () => {
  const h = makeHarness(undefined, { defaults: { cwd: '', permissionMode: 'auto' } });
  const work = path.join(h.home, 'work');
  const repo = path.join(work, 'repo');
  const inner = path.join(repo, 'inner');
  const other = path.join(work, 'other');
  for (const d of [inner, other]) fs.mkdirSync(d, { recursive: true });
  h.cfg.defaults.cwd = work;
  h.cfg.defaults.folders = { [repo]: { permissionMode: 'full' }, [inner]: { permissionMode: 'ask' } };
  assert.equal(h.runner.create({ text: 'hi', cwd: repo }).thread.permissionMode, 'full');
  assert.equal(h.runner.create({ text: 'hi', cwd: path.join(repo, '.') }).thread.permissionMode, 'full');
  assert.equal(h.runner.create({ text: 'hi', cwd: inner }).thread.permissionMode, 'ask', 'the longer folder');
  assert.equal(h.runner.create({ text: 'hi', cwd: other }).thread.permissionMode, 'auto');
  assert.equal(h.runner.create({ text: 'hi' }).thread.permissionMode, 'auto', 'the default folder');
  assert.equal(h.runner.create({ text: 'hi', cwd: repo, origin: 'schedule', scheduleId: 'sc1' }).thread.permissionMode, 'full', 'a schedule with no mode');
  assert.equal(h.runner.create({ text: 'hi', cwd: repo, permissionMode: 'ask' }).thread.permissionMode, 'ask');
  // A folder named "repo-2" isn't under "repo".
  fs.mkdirSync(repo + '-2');
  assert.equal(h.runner.create({ text: 'hi', cwd: repo + '-2' }).thread.permissionMode, 'auto');
  assert.deepEqual(h.runner.hello().defaults.folders, { [repo]: { permissionMode: 'full' }, [inner]: { permissionMode: 'ask' } });
});

test("a thread in a git worktree of a folder with its own mode starts on it", () => {
  const h = makeHarness(undefined, { defaults: { cwd: '', permissionMode: 'auto' } });
  fs.mkdirSync(path.join(h.home, 'repo'));
  const repo = fs.realpathSync(path.join(h.home, 'repo'));
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'ignore' });
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'first');
  const tree = path.join(h.home, 'repo-threads', 'slot-1');
  git('worktree', 'add', '-q', '-b', 'thread/x', tree);
  h.cfg.defaults.cwd = repo;
  h.cfg.defaults.folders = { [repo]: { permissionMode: 'full' } };
  assert.equal(h.runner.create({ text: 'hi', cwd: tree, worktree: false }).thread.permissionMode, 'full');
});

test('with no folders, hello says nothing about them', () => {
  assert.ok(!('folders' in makeHarness().runner.hello().defaults));
});
