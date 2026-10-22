import { Component, type ErrorInfo, type ReactNode } from "react";
import type { Language } from "../types";
import { Button } from "../components/ui/button";

/** Keep navigation and the app's close dialog available if the transfer UI fails. */
export class FileTransferBoundary extends Component<
  { language: Language; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("File transfer page failed", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const zh = this.props.language === "zh-CN";
    return (
      <section
        role="alert"
        className="rounded-2xl border border-rose-200 bg-white p-6 dark:border-rose-900 dark:bg-slate-950"
      >
        <h1 className="font-semibold">
          {zh
            ? "文件传输页面暂时无法显示"
            : "File Transfer could not be displayed"}
        </h1>
        <p className="my-3 text-sm text-slate-500">
          {zh
            ? "可以重新打开此页面，或使用侧边栏前往其他功能。"
            : "Reopen this page, or use the sidebar to continue elsewhere."}
        </p>
        <Button onClick={() => this.setState({ failed: false })}>
          {zh ? "重新打开文件传输" : "Reopen File Transfer"}
        </Button>
      </section>
    );
  }
}
