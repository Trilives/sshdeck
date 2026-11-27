import { Card, CardHeader } from "../components/ui/card";
import { PageTitle } from "../components/PageTitle";
import { LogTable } from "../components/LogTable";
import { t } from "../i18n";
import type { Language, LogEntry } from "../types";

export function LogsPage(props: { language: Language; logs: LogEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <PageTitle page="logs">{t(props.language, "logsTitle")}</PageTitle>
      </CardHeader>
      <LogTable language={props.language} logs={props.logs} maxHeight="max-h-[32rem]" />
    </Card>
  );
}
