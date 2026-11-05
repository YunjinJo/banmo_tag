// .claude/hooks/block-main-commit.js — PreToolUse 훅 (Bash / PowerShell)
// main 브랜치에 직접 커밋하거나 main 으로 push 하는 명령을 막습니다.
// (무료 플랜의 비공개 저장소는 GitHub 브랜치 보호 규칙을 쓸 수 없어 그 역할을 대신함)
// 작업은 feature/xxx 또는 bugfix/xxx 브랜치에서 하고 PR 로 main 에 합칩니다 (CLAUDE.md 참고).
//
// 입력: stdin 의 훅 JSON ({ tool_input: { command } })
// 출력: 막을 때 exit 2 + stderr 에 이유 (Claude 에게 전달됨), 그 밖에는 exit 0
'use strict';

const fs = require('fs');
const path = require('path');

// stdin 의 JSON (Windows 에서 파이프로 받으면 앞에 BOM 이 붙을 수 있어 제거)
function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8').replace(/^﻿/, '');
  } catch {
    return '';
  }
}

// 현재 브랜치 이름 (.git/HEAD 를 직접 읽음 — git 이 PATH 에 없어도 동작)
function currentBranch(startDir) {
  let dir = startDir;
  for (let i = 0; i < 10 && dir; i++) {
    const head = path.join(dir, '.git', 'HEAD');
    if (fs.existsSync(head)) {
      const m = fs.readFileSync(head, 'utf8').match(/^ref:\s*refs\/heads\/(.+)\s*$/m);
      return m ? m[1].trim() : null; // detached HEAD 이면 null
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// 명령을 ; && || | 줄바꿈 기준으로 나눈 조각 중 git 명령만
function gitSegments(command) {
  return String(command || '')
    .split(/;|&&|\|\||\||\r?\n/)
    .map(s => s.trim())
    .filter(s => /(^|[\s"'&])git(\.exe)?\s/i.test(s + ' '));
}

const MAIN_REFSPEC = /(^|\s|:)(refs\/heads\/)?(main|master)(\s|$)/;

function check(command, branch) {
  for (const seg of gitSegments(command)) {
    const sub = seg.replace(/^.*?\bgit(\.exe)?\s+/i, '').replace(/^(-[cC]\s+\S+\s+)+/, '');
    if (/^commit\b/.test(sub) && (branch === 'main' || branch === 'master')) {
      return `main 브랜치에서 직접 커밋할 수 없습니다. 먼저 작업 브랜치를 만드세요: git checkout -b feature/<작업 이름> (버그 수정은 bugfix/<이름>)`;
    }
    if (/^push\b/.test(sub)) {
      const args = sub.replace(/^push\b/, ' ');
      if (MAIN_REFSPEC.test(args)) {
        return 'main 브랜치로 직접 push 할 수 없습니다. 작업 브랜치를 push 한 뒤 PR 을 만드세요 (gh pr create).';
      }
      // 대상 브랜치를 적지 않은 push 는 현재 브랜치로 감
      const positional = args.trim().split(/\s+/).filter(a => a && !a.startsWith('-'));
      if (positional.length <= 1 && (branch === 'main' || branch === 'master')) {
        return '지금 main 브랜치라 이 push 는 main 으로 갑니다. 작업 브랜치로 옮긴 뒤 push 하고 PR 을 만드세요.';
      }
    }
  }
  return null;
}

let input = {};
try {
  input = JSON.parse(readStdin() || '{}');
} catch {
  process.exit(0); // 입력을 해석할 수 없으면 막지 않음
}
const command = input.tool_input && input.tool_input.command;
const branch = currentBranch(input.cwd || process.cwd());
const reason = check(command, branch);
if (reason) {
  process.stderr.write(`[banmo_tag 훅] ${reason}\n`);
  process.exit(2);
}
process.exit(0);
