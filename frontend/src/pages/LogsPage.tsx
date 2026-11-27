import { Card, CardHeader, CardTitle } from "../components/ui/card";
import { LogTable } from "../components/LogTable";
import { t } from "../i18n";
import type { Language, LogEntry } from "../types";

export function LogsPage(props: { language: Language; logs: LogEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(props.language, "logsTitle")}</CardTitle>
      </CardHeader>
      <LogTable language={props.language} logs={props.logs} maxHeight="max-h-[32rem]" />
    </Card>
  );
}
