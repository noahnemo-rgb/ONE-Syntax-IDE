import clsx from "clsx";

/** Renders a unified diff as escaped text; AI output is never interpreted as HTML. */
export function DiffView({ diff }: { diff: string }) {
  const lines = diff.replace(/\r\n/g, "\n").split("\n");
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-background p-4 font-mono text-xs leading-5">
      {lines.map((line, i) => (
        <div
          key={i}
          className={clsx(
            line.startsWith("+") && !line.startsWith("+++") && "bg-emerald-500/10 text-emerald-300",
            line.startsWith("-") && !line.startsWith("---") && "bg-red-500/10 text-red-300",
            line.startsWith("@@") && "text-sky-300",
            (line.startsWith("+++") || line.startsWith("---")) && "text-muted",
          )}
        >
          {line || " "}
        </div>
      ))}
    </pre>
  );
}
