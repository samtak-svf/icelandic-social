// @ts-check
// The tables of tooling/ci-measure.mjs, as text.

/** Under this many samples a row is an anecdote (#393 asks for 10 PRs). */
const MIN_SAMPLE = 10;

/** @param {number} value */
const fixed = (value) => value.toFixed(1).padStart(6);

/** @param {import("../ci-measure.mjs").Spread} s */
const cell = (s) => `${fixed(s.median)} ${fixed(s.p90)} ${fixed(s.max)}`;

/** @param {number} n */
const few = (n) => (n < MIN_SAMPLE ? " few" : "");

/**
 * The tables, as text.
 * @param {ReturnType<typeof import("../ci-measure.mjs").report>} data
 * @param {boolean} steps
 */
export function render(data, steps) {
  const lines = [`window ${data.since} .. ${data.until}: ${data.runs} runs, ${data.jobs} jobs`, ""];
  lines.push("runs and job minutes per event");
  for (const row of data.events) {
    lines.push(
      `  ${row.event.padEnd(20)} ${String(row.runs).padStart(5)} runs ${((row.runs / data.runs) * 100).toFixed(0).padStart(3)}%  ran ${fixed(row.jobMinutes)} min  waited ${fixed(row.waitMinutes)} min`,
    );
  }
  lines.push("", "per job, minutes (median p90 max): wait | run | total");
  for (const row of data.jobRows) {
    lines.push(
      `  ${`${row.workflow}/${row.job}`.padEnd(30)} ${row.lane.padEnd(14)} ${row.event.padEnd(13)} n=${String(row.total.n).padStart(3)} failed=${String(row.failed).padStart(2)} ${cell(row.wait)} | ${cell(row.run)} | ${cell(row.total)}${few(row.total.n)}`,
    );
  }
  const matrix = data.matrixRows;
  if (matrix.length > 0) {
    lines.push(
      "",
      "matrix jobs whole, first leg created to last leg done, minutes (median p90 max)",
    );
    for (const row of matrix) {
      lines.push(
        `  ${`${row.workflow}/${row.job}`.padEnd(30)} ${row.lane.padEnd(14)} ${row.event.padEnd(13)} n=${String(row.total.n).padStart(3)} failed=${String(row.failed).padStart(2)} legs=${row.legs} ${cell(row.total)}${few(row.total.n)}`,
      );
    }
  }
  lines.push("", "commit wall, PR head commits waited for to the end");
  lines.push(
    `  all: n=${data.wall.n} median ${data.wall.median.toFixed(1)} p90 ${data.wall.p90.toFixed(1)} max ${data.wall.max.toFixed(1)}, with a re-run: ${data.rerunCommits}${few(data.wall.n)}`,
  );
  lines.push("", "the job that finished last on a commit");
  for (const row of data.pace) {
    lines.push(
      `  ${row.key.replace("\t", " ").padEnd(46)} n=${String(row.wall.n).padStart(3)} wall ${cell(row.wall)}${few(row.wall.n)}`,
    );
  }
  lines.push("", "commit wall by what the path filters let run");
  for (const row of data.shapes) {
    lines.push(
      `  n=${String(row.wall.n).padStart(3)} wall ${cell(row.wall)}  ${row.shape}${few(row.wall.n)}`,
    );
  }
  lines.push("", "PR open to merge, minutes");
  lines.push(
    `  n=${data.merge.n} median ${data.merge.median.toFixed(1)} p90 ${data.merge.p90.toFixed(1)} max ${data.merge.max.toFixed(1)}${few(data.merge.n)}`,
  );
  if (steps) {
    lines.push("", "slowest steps, seconds (median p90 max)");
    for (const row of data.steps.slice(0, 40)) {
      lines.push(
        `  n=${String(row.seconds.n).padStart(3)} ${cell(row.seconds)}  ${row.key.replaceAll("\t", " / ")}`,
      );
    }
  }
  return lines.join("\n");
}
