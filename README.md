# 中国节假日日历订阅

基于国务院办公厅正式通知维护的中国法定节假日 iCalendar（ICS）订阅。项目提供两个日历：

- `china-holidays.ics`：法定节假日和调休上班日。
- `china-holidays-only.ics`：仅法定节假日。

## 环境要求

项目只依赖 Node.js 内置模块，不需要安装第三方 npm 包。要求 Node.js 20 或更高版本。

先确认本机环境并运行完整检查：

```bash
node --version
npm run build
```

常用命令：

| 命令 | 用途 |
| --- | --- |
| `npm run generate` | 根据 `data/*.json` 重新生成两个 ICS 文件 |
| `npm run check` | 只校验节假日 JSON 数据 |
| `npm test` | 运行生成器和官方通知解析器测试 |
| `npm run build` | 生成 ICS 并运行全部测试 |
| `npm run dev` | 在本地预览订阅页面 |
| `npm run update` | 查询下一年度国务院正式通知 |

生成结果位于 `public/`。本地预览：

```bash
npm run dev
```

浏览器打开 `http://127.0.0.1:8000`。

## 第一次发布到 GitHub

### 1. 创建空的 GitHub 仓库

登录 GitHub，选择 **New repository**，建议填写：

- Repository name：`calendar-subscription`
- Visibility：`Public`
- 不勾选 **Add a README file**
- 不选择 `.gitignore` 模板
- 不额外创建 License

本地项目已经包含 README、`.gitignore` 和 License。如果远程仓库也初始化这些文件，第一次推送时会产生不必要的历史冲突。

创建完成后，GitHub 会显示仓库地址，例如：

```text
https://github.com/<你的用户名>/calendar-subscription.git
```

### 2. 初始化本地 Git 仓库

在终端中执行，注意把用户名和仓库地址替换成自己的：

```bash
cd /Users/yingzheng/SunsetZone/develop/calendar-subscription

npm run build

git init -b master
git add .
git status
git commit -m "Initial China holidays calendar subscription"

git remote add origin https://github.com/<你的用户名>/calendar-subscription.git
git remote -v
git push -u origin master
```

如果本机 Git 版本不支持 `git init -b master`，改用：

```bash
git init
git branch -M master
```

如果 `git push` 要求认证，GitHub 不能再使用账号密码进行 Git 认证。可以安装 [GitHub CLI](https://cli.github.com/) 后执行：

```bash
gh auth login
git push -u origin master
```

也可以使用已经配置好的 SSH 地址：

```bash
git remote add origin git@github.com:<你的用户名>/calendar-subscription.git
```

如果之前已经添加过错误的 `origin`，使用下面的命令修改，不要重复执行 `git remote add`：

```bash
git remote set-url origin <正确的仓库地址>
```

### 3. 配置 GitHub Actions 权限

打开仓库：

```text
Settings
→ Actions
→ General
→ Workflow permissions
```

建议配置为：

1. 选择 **Read and write permissions**。
2. 勾选 **Allow GitHub Actions to create and approve pull requests**。
3. 点击 **Save**。

本项目不会自动批准或合并 PR，这个权限只是让定时工作流能够创建 Draft Pull Request。

同时确认仓库的 **Issues** 功能处于开启状态。官方页面无法访问或解析失败时，自动更新工作流会创建或更新 Issue。

### 4. 启用 GitHub Pages

打开：

```text
Settings
→ Pages
→ Build and deployment
→ Source
→ GitHub Actions
```

选择 GitHub Actions 后无需选择发布分支。本项目的 `Build and deploy calendar` 工作流会生成并部署 `public/`。

### 5. 检查第一次部署

打开仓库顶部的 **Actions** 页面，找到：

```text
Build and deploy calendar
```

等待 `build` 和 `deploy` 两个任务都变成绿色。发布地址通常为：

```text
https://<你的用户名>.github.io/calendar-subscription/
https://<你的用户名>.github.io/calendar-subscription/china-holidays.ics
https://<你的用户名>.github.io/calendar-subscription/china-holidays-only.ics
```

如果仓库名称不是 `calendar-subscription`，URL 中也要使用实际仓库名称。

## 在 iPhone 上订阅

推荐先用 Safari 打开 GitHub Pages 首页，然后点击订阅按钮。

也可以手动添加：

1. 复制 `china-holidays.ics` 的完整 HTTPS 地址。
2. 打开 iPhone 的“日历”应用。
3. 选择“日历”→“添加日历”→“添加订阅日历”。
4. 粘贴订阅地址并确认。

两个订阅文件的区别：

- `china-holidays.ics`：包含放假日期和调休上班日。
- `china-holidays-only.ics`：只包含放假日期。

## 自动发现下一年度安排

`Check next-year holidays` 工作流会在每年 9 月至次年 1 月，每天北京时间 09:23 查询国务院政策文件库。定时任务只从默认分支 `master` 运行，实际执行时间可能因 GitHub Actions 负载稍有延迟。

目标年份按照 `data/` 中最新年份加一计算。例如目前最新文件是 `data/2026.json`，工作流就会查找 2027 年正式通知。

自动更新流程：

```text
查询国务院政策文件库
        ↓
未发布：正常结束，不修改任何文件
        ↓
发现正式通知：验证标题、机关、文号和 gov.cn 来源
        ↓
解析放假日期和调休上班日
        ↓
运行数据校验、ICS 生成和全部测试
        ↓
创建 Draft Pull Request
```

数据不会未经人工确认直接发布。页面结构变化、网络错误或日期校验失败时，工作流会创建或更新名为“节假日自动更新失败”的 GitHub Issue。

### 手动运行自动检查

在 GitHub 仓库中打开：

```text
Actions
→ Check next-year holidays
→ Run workflow
```

`year` 留空时自动检查最新数据的下一年，也可以明确填写目标年份。正式通知尚未发布时，工作流显示成功但不会创建 PR，这是正常行为。

本地也可以执行：

```bash
npm run update
```

指定年份：

```bash
node scripts/update-holidays.mjs --year 2027
```

对已经存在的年度做只读解析验证，不覆盖 JSON：

```bash
node scripts/update-holidays.mjs --year 2026 --force --dry-run
```

### 收到自动 Draft PR 后怎么做

1. 打开 PR 中给出的国务院官方来源链接。
2. 在 **Files changed** 中检查新生成的 `data/<年份>.json`。
3. 逐项核对每个假期的开始日期、结束日期和调休上班日期。
4. 确认 PR 的自动测试全部通过。
5. 点击 **Ready for review**，再点击 **Merge pull request**。
6. 合并到 `master` 后，`Build and deploy calendar` 会自动重新发布 GitHub Pages。

原有 ICS 订阅地址不会改变。iPhone 日历后续刷新时会获取新年度事件。

## 手动添加或修正年度数据

如果官方页面结构变化导致自动解析暂时不可用，可以手动维护：

1. 等待国务院办公厅发布下一年度正式通知，不使用媒体预测日期。
2. 复制 `data/2026.json`，创建新的年度文件。
3. 按正式通知填写假期区间、调休上班日、文号、发布日期和来源链接。
4. 如果是在修正已经发布的数据，同时更新 `updated_at` 并递增 `revision`。
5. 运行生成器和测试。
6. 提交 Pull Request，并在合并前由另一人对照原文复核。

`off` 区间的起止日期均包含在假期内；生成器会自动把 ICS 的 `DTEND` 转换为排他日期。

提交本地修改：

```bash
npm run build
git add .
git commit -m "Add <年份> China holiday schedule"
git push
```

## 常见问题

### Pages 页面返回 404

- 确认 **Settings → Pages → Source** 已选择 GitHub Actions。
- 确认 `Build and deploy calendar` 的 `build` 和 `deploy` 都成功。
- 确认 URL 中包含正确的仓库名称。

### 自动更新无法创建 PR

- 检查 **Settings → Actions → General → Workflow permissions**。
- 开启 **Read and write permissions**。
- 开启 **Allow GitHub Actions to create and approve pull requests**。

### 自动检查没有发现下一年度数据

这通常表示国务院正式通知尚未发布。媒体预测、日历推算和转载文章不会被自动化程序采用。

### iPhone 没有立即显示更新

订阅日历的刷新时间由 iPhone 控制，服务端无法要求它立即刷新。确认 GitHub Pages 上的 ICS 已经更新后，等待客户端下一次刷新即可。

### 自动更新创建了失败 Issue

打开 Issue 查看错误日志和对应的 Actions 运行记录。解析器遇到页面结构变化、正文天数不一致或网络错误时会停止，不会把不确定的数据发布给订阅用户。

## 数据来源

- [2025 年部分节假日安排，国办发明电〔2024〕12号](https://www.gov.cn/gongbao/2024/issue_11726/material/gwygb202433.pdf)
- [2026 年部分节假日安排，国办发明电〔2025〕7号](https://www.gov.cn/gongbao/2025/issue_12406/material/gwygb202532.pdf)

本项目并非政府官方网站。发现数据问题时，请以国务院正式文件为准并提交勘误。

## 设计约定

- 每个放假日生成一个透明的全天事件，并显示“第几天/共几天”。
- 每个调休上班日生成一个 09:00–18:00 的忙碌事件，并在开始前 60 分钟提醒。
- 日历包含 `Asia/Shanghai` 时区定义，事件 `UID` 根据日期和事件类型稳定生成。
- 事件说明保留国务院通知原文和官方来源链接。
- 日历建议客户端每日检查一次更新，但实际刷新时间由日历客户端决定。
- 日历文件使用 UTF-8、CRLF 和 RFC 5545 内容行折叠。

## License

代码采用 [MIT License](LICENSE)。政府公开文件中的事实数据不因本项目而产生额外权利。
