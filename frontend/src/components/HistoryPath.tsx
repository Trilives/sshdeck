export function HistoryPath({ path }: { path: string }) {
  // Keep the final directory and any trailing separators together.
  const lastDirectory = Math.max(0, path.search(/[/\\][^/\\]+[/\\]*$/));
  return (
    <span title={path} className="flex min-w-0">
      <span className="min-w-0 truncate">{path.slice(0, lastDirectory)}</span>
      <span className="max-w-full shrink-0 truncate [direction:rtl]">
        <bdi dir="ltr">{path.slice(lastDirectory)}</bdi>
      </span>
    </span>
  );
}
