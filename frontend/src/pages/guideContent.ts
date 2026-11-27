export type GuideText = readonly [zh: string, en: string];

export interface GuideItem {
  title: GuideText;
  body: GuideText;
}

export interface GuideSection {
  title: GuideText;
  items: GuideItem[];
}

export const quickStart: GuideSection = {
  title: ["快速开始", "Quick start"],
  items: [
    {
      title: ["添加主机", "Add a host"],
      body: [
        "到「远程连接」新建或导入主机。首次连接前准备好服务器地址、登录用户和密码或私钥。",
        "In Remote Connections, create or import a host. Have its address, login user, and password or private key ready for the first connection.",
      ],
    },
    {
      title: ["选择要做的事", "Choose a task"],
      body: [
        "在「远程连接」打开远程目录或执行指令，在「文件传输」复制文件，在「端口转发」访问另一侧的服务。",
        "Use Remote Connections to open a folder or run a command, File Transfer to copy files, and Port Forwarding to reach a service on the other side.",
      ],
    },
    {
      title: ["查看结果", "Check the result"],
      body: [
        "复制进度看「传输队列」，运行中的转发看「主页」，遇到连接错误可查看「日志」。",
        "Check the Transfer queue for copy progress, Home for running forwards, and Logs for connection errors.",
      ],
    },
  ],
};

export const guideSections = {
  hosts: {
    title: ["主机配置与认证", "Hosts and authentication"],
    items: [
      {
        title: ["新建或编辑主机", "Create or edit a host"],
        body: [
          "在「远程连接」点击「新建主机」，填写名称、远程 IP（也可填域名）、登录用户和 SSH 端口（默认 22），然后保存。修改配置时展开主机，点击「编辑主机」。",
          "In Remote Connections, choose New Host. Enter a name, remote IP or hostname, login user, and SSH port (22 by default), then save. Expand a host and choose Edit Host to change its settings.",
        ],
      },
      {
        title: ["私钥与跳板机", "Private keys and jump hosts"],
        body: [
          "私钥文件留空会沿用 OpenSSH 的默认身份配置。需要指定时，填写私钥路径，如 ~/.ssh/id_ed25519。SSHDeck 上传时使用对应公钥。跳板机可填 user@jump-host:port，多个跳板用逗号分隔。",
          "Leave Key File blank to use OpenSSH defaults, or enter a private-key path such as ~/.ssh/id_ed25519. SSHDeck uploads the matching public key. For ProxyJump, enter user@jump-host:port and separate multiple hops with commas.",
        ],
      },
      {
        title: ["密码连接与上传密钥", "Password login and key upload"],
        body: [
          "出现登录提示时输入服务器密码。要配置免密登录，展开主机后点「上传密钥」。程序会先验证已有免密连接，必要时才用服务器密码上传本机公钥。未指定私钥时，上传流程使用或生成 %USERPROFILE%\\.ssh\\id_ed25519。密码只在会话或操作期间使用。",
          "Enter the server password when prompted. Under an expanded host, Upload Key checks existing passwordless access before uploading the local public key. With no Key File set, upload uses or creates %USERPROFILE%\\.ssh\\id_ed25519. Passwords stay in the session or operation.",
        ],
      },
      {
        title: ["导入、导出与备份", "Import, export, and backup"],
        body: [
          "在「远程连接」的「导入」或「导出」菜单选择文件或本机 SSH 配置，再勾选主机。用 SSHDeck 文件备份主机与端口转发。SSH 配置只包含连接参数。遇到重复地址时，按提示选择覆盖或跳过。",
          "In Remote Connections, use Import or Export, choose a file or your local SSH config, and select the hosts. An SSHDeck file backs up hosts and port forwards. SSH config carries connection settings. For duplicate addresses, choose whether to overwrite or skip them.",
        ],
      },
    ],
  },
  remote: {
    title: ["远程连接", "Remote Connections"],
    items: [
      {
        title: ["选择目录并打开", "Choose and open a folder"],
        body: [
          "展开主机，点击「选择目录」。在「浏览目录」中逐级展开，或从「历史目录」找到用过的路径。选中后点「终端」或「VS Code」，直接打开该目录。",
          "Expand a host and open the picker with Choose folder. Browse the tree or find a path in Folder history, then select Terminal or VS Code to open it.",
        ],
      },
      {
        title: ["重开历史路径", "Reopen a recent path"],
        body: [
          "用终端或 VS Code 打开目录后，路径会按最近使用时间排列。点击路径可用终端重开，或点击同行的 VS Code 图标。「刷新历史」可同步记录，也可将历史路径填入目录框后修改。",
          "Opening a folder in Terminal or VS Code moves it to the top of the recent list. Click the path to reopen it in Terminal or use the VS Code icon. Refresh history to sync the list, or copy a recent path into the field to edit it.",
        ],
      },
      {
        title: ["手动指定路径与 VS Code", "Enter a path or connect in VS Code"],
        body: [
          "也可以在「打开远程目录」直接输入路径。留空时，「终端」打开远程家目录，「VS Code」连接主机。使用 VS Code 前请安装 VS Code 和 Remote‑SSH 扩展。",
          "You can also type a path in Open a remote directory. With the field empty, Terminal opens the remote home directory and VS Code connects to the host. Install VS Code and its Remote‑SSH extension first.",
        ],
      },
      {
        title: ["发送指令", "Send a command"],
        body: [
          "展开主机后点「发送指令」，填入命令并执行，需要时选择「使用密码发送」。结果显示在「输出」区，等待时可以取消。交互式或长时间运行的任务可在终端里执行。",
          "Expand a host, choose Send Command, enter the command, and run it. Use Send with password when required. Read the result in Output and cancel if you need to stop waiting. Use a terminal for interactive or long-running tasks.",
        ],
      },
    ],
  },
  files: {
    title: ["文件传输", "File Transfer"],
    items: [
      {
        title: ["选择来源和接收端", "Choose source and destination"],
        body: [
          "两栏可分别选择本机或已保存的主机。选中远程主机后，等待连接完成。需要认证时，点击钥匙图标，输入密码或私钥口令，也可选择「上传密钥并连接」。",
          "Select This computer or a saved host in each pane. Wait for the remote connection to complete. If prompted, use the key button to enter a password or key passphrase, or choose Upload key and connect.",
        ],
      },
      {
        title: ["浏览与筛选", "Browse and filter"],
        body: [
          "双击文件夹进入，点小箭头展开。点路径栏可浏览目录树、查找历史或手动定位，选好后点击「使用此目录」。列表上方有「后退」和「上一级」，下方可「筛选当前目录」。以 . 开头的条目默认隐藏，可在文件面板或目录选择器中开启「隐藏文件」。",
          "Double-click a folder to enter it or use its arrow to expand it. Open the path bar to browse the tree, use history, or locate a path, then select Use this folder. Back and Parent folder sit above the list, and Filter this folder sits below. Dotfiles are hidden by default. Turn on Hidden files in the pane or picker to show them.",
        ],
      },
      {
        title: ["最近传输目录", "Recent transfer folders"],
        body: [
          "目录选择器的「最近传输」会记录实际传过文件的来源和目标目录。远程主机也可从同一页查找「远程连接」里用过的路径。",
          "Recent transfer in the folder picker lists source and destination folders from actual file transfers. On remote hosts, the same tab also offers paths opened in Remote Connections.",
        ],
      },
      {
        title: ["勾选并确认发送", "Select and confirm a copy"],
        body: [
          "用复选框、Ctrl / Shift 或全选勾选普通文件和文件夹。点击「发送到右侧」或「发送到左侧」，也可拖到另一栏的目录。在「确认传输」核对目标目录，对同名文件选择「跳过」「覆盖」或「保留两份」，然后点「加入传输队列」。复制后保留来源文件。",
          "Select regular files and folders with checkboxes, Ctrl / Shift, or Select this folder. Choose Send right or Send left, or drag the selection into the other pane. In Confirm transfer, check the destination, choose Skip, Overwrite, or Keep both for existing files, and choose Add to queue. Source files are kept.",
        ],
      },
      {
        title: ["在队列中查看结果", "Check the transfer queue"],
        body: [
          "目录会先扫描再复制。队列可查看任务状态、进度、速度和剩余时间，并可取消或重试。切换页面时传输继续。选择复制内容时避开符号链接和特殊文件。远端覆盖需要服务器支持 OpenSSH 的 posix-rename 扩展。",
          "Folders are scanned before copying. The queue shows status, progress, speed, and time remaining. You can cancel or retry, and transfers continue when you switch pages. Choose regular files and folders without symbolic links or special files. Remote overwrite requires the server’s OpenSSH posix-rename extension.",
        ],
      },
      {
        title: ["分发到多个主机", "Distribute to multiple hosts"],
        body: [
          "开启右上角「分发模式」，勾选并连接接收主机。可为每个接收端选目标目录，也可填写统一目标路径后点「应用到接收端」。在左栏勾选来源文件，再点「开始分发」。",
          "Enable Distribute in the top-right corner, select recipients, and connect them. Choose a folder for each recipient, or enter a shared destination path and choose Apply to recipients. Select the source files on the left, then choose Distribute files.",
        ],
      },
      {
        title: ["在远程主机之间直传", "Transfer directly between servers"],
        body: [
          "两端都是远程主机时，可在「确认传输」开启「不经过本机」。分发时所有接收端也须是远程主机。来源主机需要 sftp、能访问接收端的 SSH 地址和端口，并能免密登录且信任其指纹。直传显示估算进度。默认的远程复制经本机流式中转。",
          "In Confirm transfer, choose Bypass this computer when both endpoints are remote. Every distribution recipient must also be remote. The source needs sftp, network access to the recipient’s SSH address and port, passwordless login, and a trusted host key. Direct progress is estimated. Standard server-to-server copies stream through this computer.",
        ],
      },
      {
        title: ["配置直传密钥", "Set up direct SSH access"],
        body: [
          "开启直传后，为各个接收端点击「配置直传密钥」，按提示输入所需密码。已有免密连接时跳过配置。需要配置时，将来源主机的公钥授权给接收端并验证连接，私钥留在来源主机。自动配置适用于标准 POSIX/OpenSSH 服务器。",
          "With bypass enabled, choose Set up direct SSH access for each recipient and enter a password if prompted. Setup skips recipients that already accept passwordless access. When needed, it authorizes the source’s public key on the recipient and verifies the connection. The private key stays on the source. Automatic setup supports standard POSIX/OpenSSH servers.",
        ],
      },
    ],
  },
  forwards: {
    title: ["端口转发", "Port Forwarding"],
    items: [
      {
        title: ["选择模式", "Choose a mode"],
        body: [
          "Local 在本机监听，把请求送到 SSH 服务器能访问的服务。Remote 在 SSH 服务器上监听，把请求转到本机能访问的服务。Dynamic 在本机监听 SOCKS 代理，给客户端填写代理地址和端口即可。",
          "Local listens on your computer and forwards to a service the SSH server can reach. Remote listens on the SSH server and forwards to a service your computer can reach. Dynamic creates a local SOCKS proxy. Enter its address and port in the client’s proxy settings.",
        ],
      },
      {
        title: ["新建、连接与停止", "Create, connect, and stop"],
        body: [
          "在「端口转发」展开主机，点击「新建端口转发」，选模式并填监听和目标地址。勾选「保持连接并自动重连」时，保存后会尝试连接，意外断开后会重试。也可以在转发条目上手动「连接」或「断开」。",
          "In Port Forwarding, expand a host and choose New Forward. Select a mode and enter listen and destination settings. Keep connected and reconnect automatically tries to connect on save and retry after an unexpected disconnect. You can also Connect or Disconnect an individual forward.",
        ],
      },
      {
        title: ["确认实际监听端口", "Check the active port"],
        body: [
          "Local 或 Dynamic 的本机端口被占用时，SSHDeck 会尝试顺延到可用端口。连接后以「主页」显示的监听地址为准。网页服务可点击「在浏览器打开」。",
          "If a Local or Dynamic port is in use, SSHDeck tries a higher available port. Check the active listen address on Home after connecting. For web services, use Open in browser.",
        ],
      },
    ],
  },
  monitoring: {
    title: ["主页、日志与排错", "Home, logs, and troubleshooting"],
    items: [
      {
        title: ["从主页管理运行中的转发", "Manage running forwards from Home"],
        body: [
          "主页显示当前连接、置顶主机和最近关键事件。可以打开置顶主机的远程连接、在浏览器打开转发地址、断开单条转发，或点击「全部断开」。",
          "Home shows current connections, pinned hosts, and recent key events. Open a pinned host in Remote Connections, open a forwarded address in your browser, disconnect one forward, or choose Stop All.",
        ],
      },
      {
        title: ["连不上或等待超时", "Connection refused or timed out"],
        body: [
          "先核对主机地址、SSH 端口和跳板机配置，再检查网络能否连到它们。到「日志」查看失败原因，需要更多细节时，在「设置」把「日志等级」调到「调试」。若应用提示缺少 OpenSSH 客户端，可按提示安装后重启应用。",
          "Check the host address, SSH port, and jump host settings, then check network reachability. Open Logs for the error and use the Debug log level in Settings for more detail. If SSHDeck prompts for OpenSSH Client, install it and restart the app.",
        ],
      },
      {
        title: ["认证失败或主机指纹变化", "Authentication failed or host key changed"],
        body: [
          "认证失败时核对登录用户、密码或私钥。收到主机指纹变化提示时，先从服务器管理员处核对指纹，再在确认可信后更新并重连。若转发因关键错误停止重试，修复后可手动连接。",
          "If authentication fails, check the login user, password, or private key. If a host key changes, verify the fingerprint with the server administrator before trusting the new key and reconnecting. If a critical error stops retries, fix the cause and reconnect manually.",
        ],
      },
    ],
  },
  settings: {
    title: ["设置与更新", "Settings and updates"],
    items: [
      {
        title: ["主题与侧栏", "Theme and sidebar"],
        body: [
          "从侧栏打开「设置」，可选择浅色、深色或跟随系统，并更改强调色。「朴素」在浅色模式用近黑，深色模式用灰色。拖动侧栏右边缘可调整宽度，下次打开会保留。",
          "Open Settings from the sidebar to choose an appearance and accent. Monochrome uses near-black in light mode and gray in dark mode. Drag the sidebar’s right edge to resize it. SSHDeck remembers the width.",
        ],
      },
      {
        title: ["开机自启和托盘运行", "Launch at login and tray behavior"],
        body: [
          "「开机自启」默认关闭，开启后会在登录 Windows 时启动 SSHDeck。在「关闭按钮行为」选择询问、最小化到托盘或退出。托盘模式会继续传输和转发，退出应用会停止这些后台任务。",
          "Enable Launch at login in Settings to open SSHDeck when you sign in to Windows. It is off by default. Set Close button behavior to ask, minimize to tray, or quit. Transfers and forwards continue in the tray and stop when the app exits.",
        ],
      },
      {
        title: ["置顶和调整主机顺序", "Pin and reorder hosts"],
        body: [
          "「远程连接」和「端口转发」共用主机顺序，置顶主机排在前面。默认可长按置顶按钮右侧的手柄，在同组内拖动。开启「自动排序主机」后，最近编辑的主机排在同组顶部，修改端口转发仍保留主机位置。历史路径按最近使用排序。",
          "Remote Connections and Port Forwarding share a host order, with pinned hosts first. By default, hold and drag the handle to the right of Pin to reorder within a group. Automatic host sorting moves hosts with recently edited settings to the top of their group. Forward edits keep the host in place. Path history is ordered by recent use.",
        ],
      },
      {
        title: ["软件更新", "Software updates"],
        body: [
          "在「设置」的「软件更新」里选择「稳定版」或「预览版」，然后「检查更新」。安装版可点击「下载并安装」，也可开启「自动更新」。免安装版下载新版 ZIP 后替换原目录即可更新。",
          "In Settings, open Software Update, choose Stable or Preview, and select Check for updates. In an installed copy, use Download & install or turn on Automatic updates. For the portable edition, download a new ZIP and replace the extracted folder.",
        ],
      },
    ],
  },
} satisfies Record<string, GuideSection>;

export const forwardExample: GuideItem & {
  fields: { label: GuideText; value: string }[];
} = {
  title: ["用 Local 转发打开远程网页", "Local forwarding example for a remote website"],
  body: [
    "如果服务器的 Web 服务监听 127.0.0.1:8000，在「新建端口转发」中填写以下字段，名称可填「远程网页」。保存并连接后，在本机浏览器打开 http://127.0.0.1:18000。",
    "If a web service listens on 127.0.0.1:8000 on the server, enter these values in New Forward. Name it Remote website, then save and connect. Open http://127.0.0.1:18000 in your local browser.",
  ],
  fields: [
    { label: ["模式", "Mode"], value: "local" },
    { label: ["本机地址", "Local Address"], value: "127.0.0.1" },
    { label: ["本机端口", "Local Port"], value: "18000" },
    { label: ["远端地址", "Remote Address"], value: "127.0.0.1" },
    { label: ["远程端口", "Remote Port"], value: "8000" },
  ],
};
