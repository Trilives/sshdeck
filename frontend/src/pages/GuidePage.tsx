import type { ReactNode } from "react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { t } from "../i18n";
import { PageHeader } from "../components/PageHeader";
import { cn } from "../lib/utils";
import type { Language } from "../types";
import { forwardExample, guideSections, quickStart, type GuideSection } from "./guideContent";

export function GuidePage({ language }: { language: Language }) {
  const locale = language === "zh-CN" ? 0 : 1;

  return (
    <div className="grid gap-4">
      <PageHeader page="guide">{t(language, "guide")}</PageHeader>
      <Card>
        <CardHeader>
          <CardDescription>{quickStart.title[locale]}</CardDescription>
        </CardHeader>
        <ol className="flex flex-wrap gap-4">
          {quickStart.items.map(({ title, body }, index) => (
            <li
              key={title[0]}
              className="min-w-0 flex-[1_1_12rem] rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
                {index + 1}
              </div>
              <h3 className="mt-3 text-sm font-semibold text-slate-950 dark:text-slate-50">
                {title[locale]}
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                {body[locale]}
              </p>
            </li>
          ))}
        </ol>
      </Card>

      <div className="[column-gap:1.25rem] [columns:24rem_2]">
        <GuidePanel section={guideSections.hosts} locale={locale} />
        <GuidePanel section={guideSections.remote} locale={locale} />
      </div>

      <GuidePanel section={guideSections.files} locale={locale} wide />

      <div className="[column-gap:1.25rem] [columns:24rem_2]">
        <GuidePanel section={guideSections.forwards} locale={locale}>
          <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-900">
            <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
              {forwardExample.title[locale]}
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              {forwardExample.body[locale]}
            </p>
            <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
              {forwardExample.fields.map(({ label, value }) => (
                <div key={label[0]}>
                  <dt className="text-xs text-slate-500 dark:text-slate-400">{label[locale]}</dt>
                  <dd className="font-mono text-slate-800 dark:text-slate-200">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </GuidePanel>
        <GuidePanel section={guideSections.monitoring} locale={locale} />
        <GuidePanel section={guideSections.settings} locale={locale} />
      </div>
    </div>
  );
}

function GuidePanel(props: {
  section: GuideSection;
  locale: 0 | 1;
  wide?: boolean;
  children?: ReactNode;
}) {
  const { section, locale, wide } = props;
  return (
    <Card className={wide ? undefined : "mb-5 break-inside-avoid last:mb-0"}>
      <CardHeader>
        <CardTitle>{section.title[locale]}</CardTitle>
      </CardHeader>
      <div className={wide ? "flex flex-wrap gap-3" : "grid gap-3"}>
        {section.items.map(({ title, body }) => (
          <div
            key={title[0]}
            className={cn(
              "rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950",
              wide && "min-w-0 flex-[1_1_17rem]",
            )}
          >
            <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
              {title[locale]}
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
              {body[locale]}
            </p>
          </div>
        ))}
        {props.children}
      </div>
    </Card>
  );
}
