import { Card } from "../components/ui/card";
import { PageHeader } from "../components/PageHeader";
import { LogTable } from "../components/LogTable";
import { t } from "../i18n";
import type { Language, LogEntry } from "../types";

export function LogsPage(props: { language: Language; logs: LogEntry[] }) {
  return (
    <div className="grid min-w-0 gap-4">
      <PageHeader page="logs">{t(props.language, "logsTitle")}</PageHeader>
      <Card>
        <LogTable language={props.language} logs={props.logs} maxHeight="max-h-[32rem]" />
      </Card>
    </div>
  );
}
