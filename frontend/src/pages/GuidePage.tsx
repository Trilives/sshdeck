import { type ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import type { Language } from "../types";

export function GuidePage(props: { language: Language }) {
  const isZh = props.language === "zh-CN";

  const quickSteps = isZh
    ? [
        [
          "1",
          "添加主机",
          "在「远程连接」新建主机，填写地址、用户和 SSH 端口；也可从文件或 SSH 配置导入。",
        ],
        [
          "2",
          "选择要做的事",
          "打开远程目录、在「文件传输」复制文件，或在「端口转发」连接远程服务。",
        ],
        [
          "3",
          "查看进度与状态",
          "文件复制看传输队列，转发状态看「主页」，连接问题到「日志」排查。",
        ],
      ]
    : [
        [
          "1",
          "Add a host",
          "Create a host in Remote Connections with its address, user and SSH port, or import hosts from a file or SSH config.",
        ],
        [
          "2",
          "Choose a task",
          "Open a remote folder, copy files in File Transfer, or connect to a remote service through Port Forwarding.",
        ],
        [
          "3",
          "Watch progress",
          "Use the transfer queue for copies, Home for running forwards, and Logs to investigate connection problems.",
        ],
      ];

  const exampleRows = isZh
    ? [
        ["目标", "远程服务器上的 127.0.0.1:8000，本地浏览器也能打开"],
        ["模式", "local"],
        ["监听地址", "127.0.0.1"],
        ["监听端口", "8000"],
        ["目标地址", "127.0.0.1"],
        ["目标端口", "8000"],
        ["打开方式", "连接成功后访问 http://127.0.0.1:8000"],
      ]
    : [
        [
          "Goal",
          "Open 127.0.0.1:8000 on the remote server from your local browser",
        ],
        ["Mode", "local"],
        ["Bind Host", "127.0.0.1"],
        ["Bind Port", "8000"],
        ["Target Host", "127.0.0.1"],
        ["Target Port", "8000"],
        ["Open", "Visit http://127.0.0.1:8000 after connecting"],
      ];

  const pageCards = isZh
    ? [
        [
          "主页",
          "监控板：完整展示当前运行中的转发，以及连接/断开/错误等关键事件。只读，不在这里改配置。",
        ],
        [
          "远程连接",
          "集中管理主机：新建、编辑、删除、置顶、发送指令、上传密钥，并用终端或 VS Code 打开远端路径。",
        ],
        [
          "文件传输",
          "双栏浏览本机和远程目录，支持隐藏文件、多选、拖拽、后台队列、多主机分发与远程直传。",
        ],
        [
          "端口转发",
          "按主机管理 Local、Remote 与 Dynamic 转发，包括新建、编辑、删除、连接和断开。",
        ],
        [
          "日志",
          "完整运行日志，按设置中的等级过滤。排查连接失败时把等级调到 debug。",
        ],
        [
          "设置",
          "切换主题、语言和日志等级，设置关闭窗口行为、自动更新，以及稳定或预览更新通道。",
        ],
      ]
    : [
        [
          "Home",
          "Dashboard: shows all running forwards plus key connect/disconnect/error events. Read-only.",
        ],
        [
          "Remote Connections",
          "Manage hosts in one place: create, edit, delete, pin, send commands, upload keys, and open remote paths in a terminal or VS Code.",
        ],
        [
          "File Transfer",
          "Browse local and remote folders side by side, including hidden files, with multiple selection, drag and drop, background transfers, distribution and direct transfers.",
        ],
        [
          "Port Forwarding",
          "Manage Local, Remote, and Dynamic forwards by host, including create, edit, delete, connect, and disconnect.",
        ],
        [
          "Logs",
          "Full runtime logs filtered by the level in Settings. Use debug to troubleshoot connection failures.",
        ],
        [
          "Settings",
          "Choose a theme, language, log level, window-close behavior, automatic updates, and the Stable or Preview update channel.",
        ],
      ];

  const modeCards = isZh
    ? [
        [
          "Local",
          "本地端口 → SSH 服务器能访问到的目标服务。最常用，适合远程数据库、内网 Web 服务。",
        ],
        [
          "Remote",
          "远程端口 → 本机服务。适合临时把本地开发服务暴露给服务器侧访问。",
        ],
        ["Dynamic", "创建 SOCKS 代理。通常只需要监听地址和监听端口。"],
      ]
    : [
        [
          "Local",
          "Local port → a service reachable from the SSH server. The most common mode.",
        ],
        [
          "Remote",
          "Remote port → a local service. Useful when the server side needs to reach your dev service.",
        ],
        [
          "Dynamic",
          "Create a SOCKS proxy. Usually only bind host and bind port are required.",
        ],
      ];

  const hostOps = isZh
    ? [
        [
          "发送指令",
          "通过 SSH 执行指令并在弹窗显示输出，可使用免密或密码认证。等待时可取消；长时间运行的任务建议在外部终端执行。",
        ],
        [
          "选择远程目录",
          "展开主机后点击「选择目录」，从根目录逐级展开，或切换「历史目录」。选好后直接点击弹窗底部的「终端」或「VS Code」。VS Code 需要安装 Remote-SSH 扩展。",
        ],
        [
          "打开终端",
          "弹出一个外部 PowerShell 窗口，已经用 ssh 连上服务器，支持 Tab 自动补全。",
        ],
        [
          "上传密钥",
          "把本机公钥写入远端 authorized_keys，配置免密登录；上传前会先检测是否已可免密。",
        ],
      ]
    : [
        [
          "Send Command",
          "Run a command over SSH and display its output, using passwordless or password authentication. Cancel while waiting; use an external terminal for long-running tasks.",
        ],
        [
          "Choose a remote folder",
          "Expand a host and choose a folder from the root tree or Folder history. Open it with Terminal or VS Code directly in the dialog. VS Code requires the Remote-SSH extension.",
        ],
        [
          "Open Terminal",
          "Pop up an external PowerShell window already connected via ssh, with Tab completion.",
        ],
        [
          "Upload Key",
          "Append your public key to remote authorized_keys; it first checks whether passwordless login already works.",
        ],
      ];

  const keyFileNote = isZh
    ? "连接时留空会使用 OpenSSH 的默认身份配置，也可指定私钥绝对路径或 ~/.ssh/id_ed25519，请不要填写 .pub 公钥文件。上传前会先检测免密登录，已经可用时跳过变更。确需上传且未指定路径时，使用 %USERPROFILE%\\.ssh\\id_ed25519；缺少密钥时会生成一对。上传到远端的只有公钥。"
    : "Leave the identity field empty to use OpenSSH's default identity configuration, or specify a private-key path such as ~/.ssh/id_ed25519. Do not select a .pub file. Upload first checks passwordless access and skips changes when it already works. If upload is needed and no path is set, it uses %USERPROFILE%\\.ssh\\id_ed25519, generating a pair if missing. Only the public key is uploaded.";

  const fileSteps = isZh
    ? [
        [
          "选择两端",
          "两侧分别选择本机或已保存的主机，可以是本机与远程，也可以是两台远程主机。连接需要认证时，可输入密码，或通过面板顶部钥匙按钮上传本机公钥并连接。",
        ],
        [
          "浏览与勾选",
          "双击文件夹进入，点击小箭头展开目录树；点击路径栏可打开目录选择器，使用目录树或历史目录。默认不显示 . 开头的隐藏文件和文件夹，文件面板和目录选择弹窗均可点击「隐藏文件」按钮显示。勾选框、Ctrl / Shift 和全选可用于多选；双击普通文件不会进入目录。",
        ],
        [
          "发送与同名文件",
          "选中文件或文件夹，点击「发送到右侧 / 左侧」，或拖到另一侧目录。在确认窗口检查目标路径，选择跳过、覆盖或保留两份，再加入队列。复制保留来源文件。",
        ],
        [
          "传输队列",
          "队列显示进度、速度和剩余时间，支持取消和重试；切换页面后仍会继续。目录先扫描再传输，远程直传显示估算进度。符号链接和特殊文件暂不复制，远端覆盖需要服务器支持 OpenSSH posix-rename 扩展。",
        ],
        [
          "多主机分发",
          "打开右上角「分发模式」，勾选多个接收端；逐个连接并选择目标目录，也可应用统一路径。使用左侧文件面板选择来源，点击「开始分发」。",
        ],
        [
          "不经过本机",
          "两端都是远程主机时，在传输确认窗口开启「不经过本机」；分发时所有接收端也必须是远程主机。源服务器需要安装 sftp，且能访问目标地址和端口。关闭此选项时，文件通过本机流式中转。",
        ],
        [
          "配置直传密钥",
          "开启直传后，为每个接收端点击「配置直传密钥」。先检查源服务器到接收端的免密连接，已可用则跳过变更；否则在源端生成或使用专用密钥，将公钥加入接收端，并验证连接。需要密码时弹窗输入，私钥始终留在源端。自动配置适用于标准 POSIX/OpenSSH 服务器，其他环境可手动配置。",
        ],
      ]
    : [
        [
          "Choose both ends",
          "Select this computer or a saved host on each side. Copy between local and remote folders, or two remote hosts. When authentication is needed, enter a password or use the pane's key button to upload this computer's public key and connect.",
        ],
        [
          "Browse and select",
          "Double-click folders to enter, or use the arrows to expand the tree. Click a path bar for the folder picker and history. Dotfiles and hidden folders are hidden by default; use Hidden files in either the file pane or folder picker to show them. Use checkboxes, Ctrl / Shift or Select all for multiple selection. Double-clicking a regular file does not open a folder.",
        ],
        [
          "Send and handle conflicts",
          "Select files or folders and choose Send right / Send left, or drag them into the other pane's folder. Confirm the destination and choose Skip, Overwrite or Keep both before adding to the queue. Copies keep the source files.",
        ],
        [
          "Transfer queue",
          "Monitor progress, speed and time remaining; cancel or retry transfers as needed. Transfers continue when switching pages. Folders are scanned first, and direct transfer progress is estimated. Symbolic links and special files are not copied; remote overwrite requires OpenSSH's posix-rename extension.",
        ],
        [
          "Distribute to hosts",
          "Enable Distribute in the top-right corner and select recipients. Connect each one and choose its destination folder, or apply a shared path. Select source files in the left pane and choose Distribute files.",
        ],
        [
          "Bypass this computer",
          "Enable this option in transfer confirmation when both endpoints are remote. All distribution recipients must also be remote. The source needs sftp and network access to the destination address and port. With this option off, files stream through this computer.",
        ],
        [
          "Set up direct SSH access",
          "With bypass enabled, set up each recipient's direct SSH access. The app first checks existing passwordless access and skips changes when it works. Otherwise, it creates or uses a dedicated source-server key, authorizes its public key on the destination and verifies the connection. Enter a password if prompted; the private key stays on the source. Automatic setup supports standard POSIX/OpenSSH servers; other environments can be configured manually.",
        ],
      ];

  const tips = isZh
    ? [
        "连接时若本机端口已被占用，会自动顺延（+1）到第一个空闲端口并以它监听；主页与「网页打开」显示实际端口。",
        "认证失败或主机指纹变化时，先检查主机配置和日志；不要将所有网络错误都当成密码错误。",
        "首次连接新主机使用 OpenSSH accept-new 策略；指纹变化时连接被拒绝并弹窗，核对后再信任。",
        "最小化到托盘可继续后台运行；退出程序会结束传输并清理程序启动的 SSH 转发，外部终端窗口不受影响。",
        "密码仅用于当前连接或操作，不写入主机配置。指纹变化时，核对服务器身份后再更新指纹并重连。",
        "在「设置 → 软件更新」选择稳定或预览通道并检查更新；免安装版请下载新版 ZIP 更新。",
      ]
    : [
        'On connect, if the local port is already in use it auto-increments to the first free port and listens there; the Home page and "Open in browser" show the actual port.',
        "For authentication failures or changed host keys, check host settings and logs. Network failures do not necessarily mean the password is wrong.",
        "First-time hosts use OpenSSH accept-new; if a host key changes the connection is refused and a dialog asks you to verify it.",
        "Minimizing to the tray keeps background work running. Exiting ends transfers and cleans up the app's SSH forwards; external terminals are unaffected.",
        "Passwords are used only for the current connection or operation and are not written to host configuration. Verify a changed host key before updating it and reconnecting.",
        "Choose Stable or Preview in Settings > Software Update and check for updates. To keep the portable edition install-free, download a newer ZIP.",
      ];

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <CardTitle>{isZh ? "使用说明" : "Guide"}</CardTitle>
          <CardDescription>
            {isZh
              ? "从添加主机开始，了解远程目录、文件传输、分发、直传认证与端口转发。"
              : "Start with a host, then learn remote folders, file transfers, distribution, direct SSH setup and port forwarding."}
          </CardDescription>
        </CardHeader>
        <div className="grid grid-cols-3 gap-4">
          {quickSteps.map(([step, title, body]) => (
            <div
              key={step}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
                {step}
              </div>
              <div className="mt-3 text-sm font-semibold text-slate-950 dark:text-slate-50">
                {title}
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                {body}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <GuidePanel title={isZh ? "文件传输怎么用" : "Using File Transfer"}>
        {fileSteps.map(([title, body]) => (
          <GuideLine key={title} title={title} body={body} />
        ))}
      </GuidePanel>

      <GuideTable
        title={
          isZh
            ? "常用样例：本地打开远程 127.0.0.1:8000"
            : "Common Example: Open Remote 127.0.0.1:8000 Locally"
        }
        description={
          isZh
            ? "这是 Local 转发的典型场景。远程服务只监听服务器自己的 127.0.0.1，但你可以通过 SSH 隧道在本地浏览器访问。"
            : "The typical Local forwarding case. The remote service only listens on the server's own 127.0.0.1, but your local browser can reach it through the SSH tunnel."
        }
        rows={exampleRows}
      />

      <div className="grid grid-cols-2 gap-5">
        <GuidePanel title={isZh ? "每个页面怎么用" : "Pages"}>
          {pageCards.map(([title, body]) => (
            <GuideLine key={title} title={title} body={body} />
          ))}
        </GuidePanel>
        <GuidePanel title={isZh ? "转发模式怎么选" : "Forwarding Modes"}>
          {modeCards.map(([title, body]) => (
            <GuideLine key={title} title={title} body={body} />
          ))}
        </GuidePanel>
      </div>

      <div className="grid grid-cols-2 gap-5">
        <GuidePanel title={isZh ? "主机操作" : "Host Actions"}>
          {hostOps.map(([title, body]) => (
            <GuideLine key={title} title={title} body={body} />
          ))}
        </GuidePanel>
        <GuidePanel
          title={isZh ? "密钥文件怎么填" : "How to Fill the Key File"}
        >
          <div className="rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
            {keyFileNote}
          </div>
        </GuidePanel>
      </div>

      <GuidePanel title={isZh ? "排错与注意事项" : "Troubleshooting"}>
        <div className="grid gap-3">
          {tips.map((tip) => (
            <div
              key={tip}
              className="flex gap-3 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600 dark:bg-slate-900 dark:text-slate-300"
            >
              <CheckCircle2
                className="mt-0.5 shrink-0 text-blue-600"
                size={17}
              />
              <span>{tip}</span>
            </div>
          ))}
        </div>
      </GuidePanel>
    </div>
  );
}

function GuideTable(props: {
  title: string;
  description: string;
  rows: string[][];
}) {
  return (
    <Card>
      <div className="text-base font-semibold text-slate-950 dark:text-slate-50">
        {props.title}
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
        {props.description}
      </p>
      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
        {props.rows.map(([label, value]) => (
          <div
            key={`${label}-${value}`}
            className="grid grid-cols-[120px_1fr] border-b border-slate-100 last:border-b-0 dark:border-slate-800"
          >
            <div className="bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
              {label}
            </div>
            <div className="px-3 py-2 text-sm text-slate-600 dark:text-slate-300">
              {value}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function GuidePanel(props: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
      </CardHeader>
      <div className="grid gap-3">{props.children}</div>
    </Card>
  );
}

function GuideLine(props: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
      <div className="text-sm font-semibold text-slate-950 dark:text-slate-50">
        {props.title}
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
        {props.body}
      </p>
    </div>
  );
}
