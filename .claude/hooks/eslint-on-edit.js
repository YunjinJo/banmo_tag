// .claude/hooks/eslint-on-edit.js — PostToolUse 훅 (Edit / Write)
// 저장소 안의 .js 파일을 고치면 그 파일만 바로 ESLint 로 검사합니다.
// 특히 shared.js 의 함수 이름을 바꾸거나 지웠는데 다른 파일이 아직 쓰고 있는 경우(no-undef)를 즉시 알려 줍니다.
//
// 입력: stdin 의 훅 JSON ({ tool_input: { file_path }, cwd })
// 출력: 문제가 있으면 exit 2 + stderr 에 ESLint 결과 (Claude 에게 전달됨), 그 밖에는 exit 0
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let input = {};
try {
  // Windows 에서 파이프로 받으면 앞에 BOM 이 붙을 수 있어 제거
  input = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^﻿/, '') || '{}');
} catch {
  process.exit(0);
}

const root = path.resolve(__dirname, '..', '..');
const filePath = input.tool_input && (input.tool_input.file_path || input.tool_input.filePath);
if (!filePath || !/\.js$/i.test(filePath)) process.exit(0);

const abs = path.resolve(input.cwd || root, filePath);
const rel = path.relative(root, abs);
// 저장소 밖, 설치 폴더·빌드 결과·예전 폴더는 검사하지 않음
if (rel.startsWith('..') || path.isAbsolute(rel) || /^(node_modules|dist|antigravity-extension|test-results|playwright-report)[\\/]/.test(rel)) {
  process.exit(0);
}

const eslintBin = path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
if (!fs.existsSync(eslintBin)) process.exit(0); // npm ci 전이면 건너뜀

// 이 스크립트를 실행 중인 node 로 ESLint 실행 (PATH 에 node 가 없어도 동작)
const result = spawnSync(process.execPath, [eslintBin, '--no-warn-ignored', rel], { cwd: root, encoding: 'utf8' });
if (result.status === 1) {
  process.stderr.write(`[banmo_tag 훅] ESLint 가 ${rel} 에서 문제를 찾았습니다. 고쳐 주세요.\n${result.stdout || ''}${result.stderr || ''}`);
  process.exit(2);
}
process.exit(0);
