import { createHash } from 'node:crypto';
import { Project, Node, SyntaxKind, ts, type FunctionDeclaration, type SourceFile } from 'ts-morph';
import type { Analysis, Decision, Diagnostic, Input, Conflict } from '../shared/types';

export class InputError extends Error {}
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function parse(code: string, label: string) {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    },
  });
  const source = project.createSourceFile('input.ts', code);
  const errors = project.getProgram().compilerObject.getSyntacticDiagnostics(source.compilerNode);
  if (errors.length)
    throw new InputError(
      `${label}: ${ts.flattenDiagnosticMessageText(errors[0].messageText, '\n')}`,
    );
  return { source, project };
}
const text = (node: Node | undefined) => node?.getFullText().trim() ?? '';
function functions(source: SourceFile) {
  return new Map(
    source
      .getStatements()
      .filter(Node.isFunctionDeclaration)
      .filter((f) => f.getName())
      .map((f) => [f.getName()!, f]),
  );
}
function context(source: SourceFile) {
  return (
    source
      .getStatements()
      .filter((n) => !Node.isFunctionDeclaration(n))
      .map(text)
      .join('\n') +
    '\n' +
    source
      .getFullText()
      .slice(source.getStatements().at(-1)?.getEnd() ?? 0)
      .trim()
  );
}
function supported(source: SourceFile) {
  const declarations = source.getStatements().filter(Node.isFunctionDeclaration);
  return (
    declarations.every((f) => f.getName() && f.getBody() && !f.isGenerator()) &&
    new Set(declarations.map((f) => f.getName())).size === declarations.length
  );
}
function calls(fn: FunctionDeclaration | undefined) {
  if (!fn) return [];
  return [
    ...new Set(
      fn.getDescendantsOfKind(SyntaxKind.CallExpression).flatMap((call) => {
        // Only direct, statically bound calls in this function. Ignore callbacks and nested functions.
        const owner = call.getFirstAncestor(
          (n) =>
            Node.isFunctionDeclaration(n) ||
            Node.isArrowFunction(n) ||
            Node.isFunctionExpression(n) ||
            Node.isMethodDeclaration(n),
        );
        if (owner !== fn || !Node.isIdentifier(call.getExpression())) return [];
        const declaration = call
          .getExpression()
          .getSymbol()
          ?.getDeclarations()
          .find(Node.isFunctionDeclaration);
        return declaration && Node.isSourceFile(declaration.getParent()) && declaration.getName()
          ? [declaration.getName()!]
          : [];
      }),
    ),
  ];
}
function signature(fn: FunctionDeclaration) {
  return fn
    .getText()
    .slice(0, fn.getBodyOrThrow().getStart() - fn.getStart())
    .trim();
}
function insertionGroups(base: FunctionDeclaration, variant: FunctionDeclaration) {
  const leading = (fn: FunctionDeclaration) =>
    fn
      .getFullText()
      .slice(0, fn.getStart() - fn.getFullStart())
      .trim();
  const trailing = (fn: FunctionDeclaration) =>
    fn
      .getBodyOrThrow()
      .getText()
      .slice(
        (fn.getStatements().at(-1)?.getEnd() ?? fn.getBodyOrThrow().getStart() + 1) -
          fn.getBodyOrThrow().getStart(),
        -1,
      )
      .trim();
  if (leading(base) !== leading(variant) || trailing(base) !== trailing(variant))
    throw new InputError(
      'Function documentation or trailing comments changed. Choose a complete version to preserve them.',
    );
  if (signature(base) !== signature(variant))
    throw new InputError('Function signatures changed. Choose a complete version.');
  const original = base.getStatements().map(text);
  const changed = variant.getStatements().map(text);
  if (new Set(original).size !== original.length)
    throw new InputError('Repeated base statements make insertion anchors ambiguous.');
  const groups: string[][] = Array.from({ length: original.length + 1 }, () => []);
  let cursor = 0;
  for (const statement of changed) {
    if (cursor < original.length && statement === original[cursor]) cursor++;
    else {
      if (original.includes(statement))
        throw new InputError('Existing statements were reordered. Choose a complete version.');
      groups[cursor].push(statement);
    }
  }
  if (cursor !== original.length)
    throw new InputError(
      'An existing statement was replaced or removed. Only additive bodies can be composed.',
    );
  if (groups.some((group) => new Set(group).size !== group.length))
    throw new InputError('Repeated inserted statements require manual review.');
  return { original, groups, trailing: trailing(base) };
}
function combine(
  base: FunctionDeclaration | undefined,
  a: FunctionDeclaration | undefined,
  b: FunctionDeclaration | undefined,
  order: 'a-first' | 'b-first',
) {
  if (!base || !a || !b)
    throw new InputError('Added or deleted functions cannot be composed automatically.');
  const left = insertionGroups(base, a),
    right = insertionGroups(base, b);
  const statements: string[] = [];
  left.groups.forEach((group, i) => {
    const first = order === 'a-first' ? group : right.groups[i];
    const second = order === 'a-first' ? right.groups[i] : group;
    // Shared insertions appear once; base statements keep their original positions.
    statements.push(...first, ...second.filter((s) => !first.includes(s)));
    if (i < left.original.length) statements.push(left.original[i]);
  });
  const result = parse(text(base), 'Composition').source.getFunctions()[0];
  result.setBodyText([...statements, left.trailing].filter(Boolean).join('\n'));
  // Reject duplicate declarations, unreachable insertions, and invalid control flow in the body.
  const candidate = text(result);
  const local = parse(candidate, 'Composition');
  const criticalCodes = new Set([2300, 2451, 2393, 1107, 1108, 7027]);
  local.project.compilerOptions.set({ allowUnreachableCode: false });
  const critical = local.project
    .getPreEmitDiagnostics()
    .find((d) => criticalCodes.has(d.getCode()));
  if (critical)
    throw new InputError(
      `Cannot compose: ${ts.flattenDiagnosticMessageText(critical.compilerObject.messageText, '\n')}`,
    );
  return candidate;
}
function observations(
  original: FunctionDeclaration | undefined,
  variant: FunctionDeclaration | undefined,
): string[] {
  if (!variant) return ['Removes this function.'];
  if (!original) return ['Adds this function.'];
  const before = original.getStatements().map(text);
  const added = variant.getStatements().filter((n) => !before.includes(text(n)));
  const facts: string[] = [];
  const newCalls = calls(variant).filter((c) => !calls(original).includes(c));
  if (newCalls.length) facts.push(`Adds calls to ${newCalls.join(', ')}.`);
  const checks = added.filter(Node.isIfStatement).length;
  if (checks)
    facts.push(`Adds or changes ${checks} conditional ${checks === 1 ? 'check' : 'checks'}.`);
  for (const statement of added) {
    const returns = [
      statement,
      ...statement.getDescendantsOfKind(SyntaxKind.ReturnStatement),
    ].filter(Node.isReturnStatement);
    for (const ret of returns) {
      const owner = ret.getFirstAncestor(
        (n) =>
          Node.isFunctionDeclaration(n) ||
          Node.isArrowFunction(n) ||
          Node.isFunctionExpression(n) ||
          Node.isMethodDeclaration(n),
      );
      if (owner !== variant) continue;
      const expression = ret.getExpression();
      if (expression && Node.isObjectLiteralExpression(expression)) {
        const error = expression.getProperty('error');
        if (error && Node.isPropertyAssignment(error)) {
          const value = error.getInitializer();
          if (value && Node.isStringLiteral(value))
            facts.push(`Can return the error “${value.getLiteralValue()}”.`);
        }
      } else if (expression && Node.isIdentifier(expression))
        facts.push(`Can return ${expression.getText()} before later statements.`);
    }
  }
  return [...new Set(facts)].slice(0, 5).length
    ? [...new Set(facts)].slice(0, 5)
    : ['Changes this function’s implementation. Inspect the source to review its behavior.'];
}
export function analyze(input: Input): Analysis {
  const base = parse(input.base, 'Base').source,
    a = parse(input.agentA, 'Agent A').source,
    b = parse(input.agentB, 'Agent B').source;
  if ([base, a, b].some((s) => s.getStatements().length > 150))
    throw new InputError('Use a smaller file (at most 150 top-level statements).');
  const maps = [functions(base), functions(a), functions(b)],
    [bm, am, cm] = maps;
  const names = [...new Set(maps.flatMap((m) => [...m.keys()]))];
  const changedA = names.filter((n) => text(bm.get(n)) !== text(am.get(n)));
  const changedB = names.filter((n) => text(bm.get(n)) !== text(cm.get(n)));
  const nodes = names.map((id) => ({
    id,
    label: id,
    line: (bm.get(id) ?? am.get(id) ?? cm.get(id))!.getStartLineNumber(),
    changedBy: [
      ...(changedA.includes(id) ? ['a' as const] : []),
      ...(changedB.includes(id) ? ['b' as const] : []),
    ],
    calls: [...new Set(maps.flatMap((m) => calls(m.get(id))))],
  }));
  const conflicts: Conflict[] = [];
  const warnings = [
    'Call edges are a union of the three snapshots, not a runtime trace. Conditions, callbacks, dynamic dispatch, and external calls are not modeled.',
    'Path warnings are conservative review candidates. This MVP does not prove semantic equivalence or infer distributed happens-before relationships.',
  ];
  if (
    [base, a, b].some((s) => !supported(s)) ||
    context(base) !== context(a) ||
    context(base) !== context(b)
  ) {
    warnings.push(
      'Imports, module statements, classes, arrow functions, anonymous functions, or overloads changed or require whole-file review.',
    );
    if (input.agentA !== input.agentB && input.agentA !== input.base && input.agentB !== input.base)
      conflicts.push({
        id: 'file',
        kind: 'file',
        functions: [],
        title: 'Review the complete file',
        explanation:
          'Changes outside supported named function bodies require choosing a complete snapshot to avoid silently dropping module-level edits.',
        canCombine: false,
        combineReason: 'Whole-file composition is outside this MVP’s supported subset.',
        base: input.base,
        a: input.agentA,
        b: input.agentB,
      });
    return {
      nodes,
      conflicts,
      changedA,
      changedB,
      warnings,
      hashes: { base: hash(input.base), a: hash(input.agentA), b: hash(input.agentB) },
    };
  }
  for (const name of changedA.filter(
    (n) => changedB.includes(n) && text(am.get(n)) !== text(cm.get(n)),
  )) {
    let canCombine = true,
      combineReason =
        'Both revisions add statements without replacing the base body. Choose which runs first, then inspect the preview.';
    try {
      combine(bm.get(name), am.get(name), cm.get(name), 'a-first');
      combine(bm.get(name), am.get(name), cm.get(name), 'b-first');
    } catch (error) {
      canCombine = false;
      combineReason = (error as Error).message;
    }
    conflicts.push({
      id: `overlap:${name}`,
      kind: 'overlap',
      functions: [name],
      title: `Both agents changed ${name}`,
      explanation:
        'These revisions change the same function differently. Their guards, side effects, or return values may depend on the chosen order.',
      canCombine,
      combineReason,
      base: text(bm.get(name)),
      a: text(am.get(name)),
      b: text(cm.get(name)),
      observationsA: observations(bm.get(name), am.get(name)),
      observationsB: observations(bm.get(name), cm.get(name)),
    });
  }
  function reaches(from: string, to: string, visited = new Set<string>()): boolean {
    if (from === to) return true;
    if (visited.has(from)) return false;
    visited.add(from);
    return (nodes.find((n) => n.id === from)?.calls ?? []).some((n) => reaches(n, to, visited));
  }
  for (const left of changedA)
    for (const right of changedB) {
      if (left === right || changedB.includes(left) || changedA.includes(right)) continue;
      const related =
        reaches(left, right) ||
        reaches(right, left) ||
        nodes.some((n) => reaches(n.id, left) && reaches(n.id, right));
      if (related)
        conflicts.push({
          id: `dependency:${left}:${right}`,
          kind: 'dependency',
          functions: [left, right],
          title: `Review ${left} with ${right}`,
          explanation:
            'Different functions changed along a shared possible call path. Review their assumptions and ordering together. Reachability alone does not establish a behavior conflict.',
          canCombine: false,
          combineReason: 'Both independent edits are retained after you acknowledge this review.',
          base: `${text(bm.get(left))}\n\n${text(bm.get(right))}`,
          a: text(am.get(left)),
          b: text(cm.get(right)),
        });
    }
  return {
    nodes,
    conflicts,
    changedA,
    changedB,
    warnings,
    hashes: { base: hash(input.base), a: hash(input.agentA), b: hash(input.agentB) },
  };
}
export function diagnostics(code: string): Diagnostic[] {
  const { project } = parse(code, 'Result');
  return project
    .getPreEmitDiagnostics()
    .slice(0, 30)
    .map((d) => ({
      line: d.getLineNumber() ?? 1,
      message: ts.flattenDiagnosticMessageText(d.compilerObject.messageText, '\n'),
      code: d.getCode(),
      category: d.getCategory() === ts.DiagnosticCategory.Error ? 'error' : 'warning',
    }));
}
export function resolve(
  input: Input,
  decisions: Record<string, Decision>,
  analysis = analyze(input),
): string {
  for (const conflict of analysis.conflicts) {
    const decision = decisions[conflict.id];
    if (!decision) throw new InputError(`A decision is required: ${conflict.title}`);
    if (
      conflict.kind === 'dependency'
        ? decision.choice !== 'reviewed'
        : !['a', 'b', 'both'].includes(decision.choice)
    )
      throw new InputError('Invalid decision for this review.');
    if (decision.choice === 'both' && (!conflict.canCombine || !decision.order))
      throw new InputError('Composition requires a supported body and an explicit order.');
  }
  if (analysis.conflicts.some((c) => c.kind === 'file'))
    return decisions.file.choice === 'a' ? input.agentA : input.agentB;
  if (input.agentA === input.agentB) return input.agentA;
  if (input.agentA === input.base) return input.agentB;
  if (input.agentB === input.base) return input.agentA;
  const base = parse(input.base, 'Base').source,
    a = parse(input.agentA, 'Agent A').source,
    b = parse(input.agentB, 'Agent B').source;
  const [bm, am, cm] = [functions(base), functions(a), functions(b)];
  const names = [...new Set([...bm.keys(), ...am.keys(), ...cm.keys()])];
  const replacements: { start: number; end: number; code: string }[] = [];
  const additions: string[] = [];
  for (const name of names) {
    const original = bm.get(name),
      left = am.get(name),
      right = cm.get(name);
    const decision = decisions[`overlap:${name}`];
    let code: string;
    if (decision?.choice === 'both') code = combine(original, left, right, decision.order!);
    else if (decision?.choice === 'a') code = text(left);
    else if (decision?.choice === 'b') code = text(right);
    else code = text(left) !== text(original) ? text(left) : text(right);
    if (original)
      replacements.push({
        start: original.getFullStart(),
        end: original.getEnd(),
        code: (original.getFullText().match(/^\s*/)?.[0] ?? '') + code,
      });
    else if (code) additions.push(code);
  }
  let output = input.base;
  for (const edit of replacements.sort((x, y) => y.start - x.start))
    output = output.slice(0, edit.start) + edit.code + output.slice(edit.end);
  if (additions.length) output += '\n' + additions.join('\n\n') + '\n';
  parse(output, 'Result');
  return output;
}

export function previewDecision(input: Input, conflict: Conflict, decision: Decision): string {
  if (conflict.kind === 'dependency') {
    if (decision.choice !== 'reviewed')
      throw new InputError('A path candidate requires an acknowledgment.');
    return `${conflict.a}\n\n${conflict.b}`;
  }
  if (decision.choice === 'a') return conflict.a;
  if (decision.choice === 'b') return conflict.b;
  if (decision.choice !== 'both' || !conflict.canCombine || !decision.order)
    throw new InputError('Choose a supported resolution and an explicit order.');
  const name = conflict.functions[0];
  return combine(
    functions(parse(input.base, 'Base').source).get(name),
    functions(parse(input.agentA, 'Agent A').source).get(name),
    functions(parse(input.agentB, 'Agent B').source).get(name),
    decision.order,
  );
}
