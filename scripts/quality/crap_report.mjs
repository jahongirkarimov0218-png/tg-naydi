#!/usr/bin/env node
/**
 * Deterministic CRAP Score Calculator (ub-mode Crapper lever for TypeScript).
 *
 * Computes per-function Cyclomatic Complexity (CC) via the TypeScript Compiler AST
 * and pairs it with V8 statement/branch coverage from `coverage/coverage-final.json`:
 *
 *   CRAP(m) = CC^2 * (1 - cov)^3 + CC
 *
 * Exits with code 1 if any target function exceeds the CRAP threshold (default < 10),
 * unless --report-only is passed.
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const CRAP_THRESHOLD = 10;
const TARGET_DIRS = ['src/lib', 'src/app/api', 'worker'];

function walkTsFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTsFiles(full));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function getFunctionName(node, sourceFile) {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.getText(sourceFile);
  if (ts.isMethodDeclaration(node) && node.name) {
    const parent = node.parent;
    const className =
      ts.isClassDeclaration(parent) && parent.name ? `${parent.name.getText(sourceFile)}.` : '';
    return `${className}${node.name.getText(sourceFile)}`;
  }
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent)) {
    return node.parent.name.getText(sourceFile);
  }
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isPropertyAssignment(node.parent)) {
    return node.parent.name.getText(sourceFile);
  }
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `<anonymous>@L${line + 1}`;
}

function computeCyclomaticComplexity(fnNode) {
  let cc = 1;

  function visit(node) {
    // Do not fold nested function bodies into outer function's complexity
    if (node !== fnNode && isFunctionLike(node)) return;

    if (
      ts.isIfStatement(node) ||
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isConditionalExpression(node) ||
      ts.isCatchClause(node)
    ) {
      cc += 1;
    } else if (ts.isCaseClause(node)) {
      cc += 1;
    } else if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (
        op === ts.SyntaxKind.AmpersandAmpersandToken ||
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken
      ) {
        cc += 1;
      }
    }

    ts.forEachChild(node, visit);
  }

  if (fnNode.body) {
    visit(fnNode.body);
  }
  return cc;
}

function computeFunctionCoverage(covFile, startLine, endLine) {
  if (!covFile) return 0;

  let total = 0;
  let covered = 0;

  // Statement coverage within [startLine, endLine]
  const stmtMap = covFile.statementMap || {};
  const stmtCounts = covFile.s || {};
  for (const [id, loc] of Object.entries(stmtMap)) {
    if (loc.start.line >= startLine && loc.end.line <= endLine) {
      total += 1;
      if ((stmtCounts[id] || 0) > 0) covered += 1;
    }
  }

  // Branch coverage within [startLine, endLine]
  const branchMap = covFile.branchMap || {};
  const branchCounts = covFile.b || {};
  for (const [id, meta] of Object.entries(branchMap)) {
    const loc = meta.loc;
    if (loc && loc.start.line >= startLine && loc.end.line <= endLine) {
      const counts = branchCounts[id] || [];
      for (const c of counts) {
        total += 1;
        if (c > 0) covered += 1;
      }
    }
  }

  if (total === 0) {
    // Fallback to fnMap hit count for single-expression functions
    const fnMap = covFile.fnMap || {};
    const fnCounts = covFile.f || {};
    for (const [id, meta] of Object.entries(fnMap)) {
      if (meta.loc && meta.loc.start.line >= startLine && meta.loc.start.line <= endLine) {
        return (fnCounts[id] || 0) > 0 ? 1 : 0;
      }
    }
    return 0;
  }

  return covered / total;
}

function normalizePathKey(p) {
  return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

function main() {
  const args = process.argv.slice(2);
  const reportOnly = args.includes('--report-only');
  const jsonOut = args.includes('--json');
  const rootDir = process.cwd();
  const covPath = path.join(rootDir, 'coverage', 'coverage-final.json');

  if (!fs.existsSync(covPath)) {
    console.error(`Missing ${covPath}. Run \`pnpm exec vitest run tests/unit tests/integration --coverage\` first.`);
    process.exit(2);
  }

  const rawCov = JSON.parse(fs.readFileSync(covPath, 'utf-8'));
  const covByNormPath = new Map();
  for (const [filePath, entry] of Object.entries(rawCov)) {
    covByNormPath.set(normalizePathKey(filePath), entry);
  }

  const files = TARGET_DIRS.flatMap((d) => walkTsFiles(path.join(rootDir, d)));
  const rows = [];

  for (const filePath of files) {
    const text = fs.readFileSync(filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.ES2022, true);
    const covEntry = covByNormPath.get(normalizePathKey(filePath));
    const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');

    function collect(node) {
      if (isFunctionLike(node) && node.body) {
        const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
        const name = getFunctionName(node, sourceFile);
        const cc = computeCyclomaticComplexity(node);
        // Skip trivial 1-line inline callbacks like `(x) => x.id`
        const isTrivialAnon = name.startsWith('<anonymous>') && cc === 1 && endLine - startLine <= 1;
        if (!isTrivialAnon) {
          const cov = computeFunctionCoverage(covEntry, startLine, endLine);
          const crap = Number((cc * cc * Math.pow(1 - cov, 3) + cc).toFixed(2));
          rows.push({
            file: relPath,
            name,
            lines: `${startLine}-${endLine}`,
            cc,
            covPct: Number((cov * 100).toFixed(1)),
            crap,
          });
        }
      }
      ts.forEachChild(node, collect);
    }

    collect(sourceFile);
  }

  rows.sort((a, b) => b.crap - a.crap);
  const offenders = rows.filter((r) => r.crap >= CRAP_THRESHOLD);

  if (jsonOut) {
    console.log(JSON.stringify({ threshold: CRAP_THRESHOLD, totalFunctions: rows.length, offendersCount: offenders.length, offenders, all: rows }, null, 2));
  } else {
    console.log(`CRAP Report (${rows.length} functions across ${TARGET_DIRS.join(', ')}; threshold < ${CRAP_THRESHOLD})`);
    console.log('CRAP   | CC  | Cov%  | Location');
    console.log('-------+-----+-------+------------------------------------------------------------');
    for (const r of rows.slice(0, 30)) {
      const mark = r.crap >= CRAP_THRESHOLD ? '!' : ' ';
      console.log(
        `${mark}${String(r.crap).padStart(5)} | ${String(r.cc).padStart(3)} | ${String(r.covPct).padStart(5)} | ${r.file}:${r.lines} ${r.name}`
      );
    }
    console.log(`\nFunctions with CRAP >= ${CRAP_THRESHOLD}: ${offenders.length}`);
  }

  if (!reportOnly && offenders.length > 0) {
    process.exit(1);
  }
}

main();
