# 提交插件 / Submitting a plugin

浮屿（原名 FocuSD Island）的插件市场从这个仓库读取 `index.json`。你的插件包放在**你自己仓库的 GitHub Release** 里，这个仓库只记录插件在哪里。

English summary at the end.

## 准备插件

1. 用脚手架创建插件并开发：`npm create fuyu-plugin@latest`（开发说明见 [浮屿插件文档](https://github.com/TixXin/fuyu/tree/main/docs/plugins)）。
2. 确认通过校验：`npx fuyu-plugin validate`。
3. 打包：`npx fuyu-plugin pack`，得到 `.package/<id>-<version>.zip`。请用这个命令打包：同样的文件总是得到同样的 zip，审核时能重新打包核对。
4. 在你的仓库发布 GitHub Release：
   - 标签是清单里的 `version`，可以带 `v`，例如 `v1.2.0` 或 `1.2.0`；
   - 附件是第 3 步的 `<id>-<version>.zip`，文件名不能改；
   - 不要标成 Draft；标成 Pre-release 的版本只在提交里写了 `"preRelease": true` 时才会收录。

一个仓库里放了多个插件时，给标签加前缀（例如 `clock-v1.2.0`），并在提交里写 `"tagPrefix": "clock-"`。

## 市场上的说明和版本历史

岛屿的插件市场在详情里显示插件的 `README.md` 和 `CHANGELOG.md`（各最多 16 KB，超出部分截掉）。构建索引时先在插件包里找这两个文件；包里没有（例如写进了 `.focusdignore`）时，到你的仓库读 Release 标签处 `path` 文件夹里的同名文件。它们和索引一起签名，跟着版本走：改了说明要发新版本才会更新。

## 第一次提交

向本仓库开 PR，只新增一个文件 `plugins/<插件 id>.json`：

```json
{
  "id": "com.example.clock",
  "repo": "example/focusd-clock",
  "publisher": "example",
  "categories": ["utilities"]
}
```

| 字段 | 说明 |
|---|---|
| `id` | 与清单 `id` 相同，文件名必须是 `<id>.json`。不能包含 `fuyu` 或 `focusd`（官方保留），也不能和已有 id 只差点号或连字符 |
| `repo` | 插件仓库 `owner/name`，必须公开 |
| `publisher` | 仓库所有者（GitHub 用户或组织），市场上显示为发布者 |
| `categories` | 可选：`productivity`、`todos`、`developer`、`media`、`messages`、`information`、`utilities` |
| `platforms` | 可选，插件能在哪些系统上运行：`windows`、`macos`。一般写在插件清单里就行；已上架的版本清单里没写时，在这里补上，市场以这里为准 |
| `preRelease` | 可选，`true` 时收录 Pre-release |
| `tagPrefix` | 可选，标签前缀 |
| `path` | 可选，插件所在的文件夹（例如 `plugins/clock`），用来找 `README.md` 和 `CHANGELOG.md`；默认是仓库根目录 |
| `domain` | 可选，你的域名（例如 `example.com`），用来成为「已验证」发布者，见下文 |
| `signingKeys` | 可选，你的签名公钥，`npx fuyu-plugin keygen` 打印的 `[{ "keyId", "publicKey" }]`，见下文「作者签名」 |
| `buildStep` | 可选，`true` 表示插件要先构建（例如 TypeScript 编译出的 `dist/` 不在仓库里），见下文「与源码一致」 |

PR 会自动检查：

- 你是 `repo` 的所有者，或者是其所属组织的**公开**成员；
- 能找到最新 Release 和附件，zip 不超过 20 MB，能通过 `fuyu-plugin validate`，清单的 id、版本与提交和标签一致；
- 包里没有常见格式的密钥：GitHub / npm 令牌、AWS 访问密钥、私钥、Slack 令牌、Google API Key、OpenAI / Anthropic API Key、Stripe 正式密钥。发现了就不收录，检查结果只写文件和行号，不写密钥本身。密钥一旦发布就算泄露了：请先在对应服务里撤销，再从包里去掉，发一个新版本。每小时的自动更新也做同样的检查；
- Release 附件和仓库在这个标签处的源码一致，见下文「与源码一致」；
- 检查结果（申请的权限、运行时、是否有自定义网页界面）列在 Actions 的运行摘要里，供审核参考。

检查通过后，维护者会**阅读插件源码**，再合并。合并时立即重建索引，几分钟后插件出现在插件市场里。

## 与源码一致

维护者审核读的是仓库在 Release 标签处的源码，用户装的是 Release 附件。为了保证两者是同一份代码，市场取仓库在这个标签处、`path` 文件夹里的文件，用 `fuyu-plugin pack` 打包，再和附件里的文件逐个比较（文件名和内容；zip 本身的字节可以不同）。

- 一致：照常上架，索引条目带 `"sourceMatch": true`。
- 不一致：PR 检查失败，并列出多了、少了、内容不同的文件；已上架插件的新版本暂缓上架，开 `review-needed` issue，维护者核对后写 `"approved": "<版本>"` 才上架。最常见的原因是附件里带了没提交的文件，或者打包前改了文件没提交。用 `npx fuyu-plugin pack` 从**已提交、已打标签**的文件打包就不会出问题。
- 插件要先构建、构建产物不进仓库时（例如脚手架的 TypeScript 模板），市场没法核对：它不运行你的构建脚本。在提交里写 `"buildStep": true`，这项检查跳过，条目不带 `sourceMatch`。

## 已验证发布者

市场在发布者名字旁显示「已验证」，表示这个发布者确实是它的名字所指的组织或个人（不代表插件安全）。两种方式，满足一种即可：

- **GitHub 组织**：组织已经在 GitHub 上验证了域名（组织主页显示 Verified），不用做任何事。
- **自己的域名**：在提交里写 `"domain": "example.com"`，并让 `https://example.com/.well-known/focusd-publisher.json` 返回 `{ "github": "<你的 publisher>" }`（HTTPS，不跳转，不超过 4 KB）。PR 会当场检查。

索引每次构建都会重新检查；文件没了或组织不再是已验证状态，标记就会去掉。暂时连不上时保留原来的状态。

## 作者签名

可选，但**只有签了名的插件会在用户的岛屿上自动更新**。岛屿还会记下第一次看到的密钥，之后换了密钥（或去掉签名）的版本要用户在插件市场确认两次才会安装，所以即使你的 GitHub 账号或仓库被盗，攻击者也不能悄悄更新用户装好的插件。

1. 只需一次：`npx fuyu-plugin keygen`，把打印的 `{ keyId, publicKey }` 写进提交的 `"signingKeys": [ ... ]`。**备份私钥**（`~/.fuyu-plugin/signing.key`；改名前放在 `~/.fly-island-plugin/` 的照常用）。
2. 每次发版：`npx fuyu-plugin pack --sign`，把 `<id>-<version>.zip` 和 `<id>-<version>.zip.sig` 一起附到 Release。
3. 第一次登记 `signingKeys` 的 PR 会检查最新 Release 已经带着用这把密钥做的签名，证明你持有私钥。

登记之后，没有签名或签名不对的新版本**不会上架**，会开一个 `review-needed` issue；维护者写 `approved` 也不能让它上架，只能由作者补上签名。已上架但还没有签名的版本，补上 `.zip.sig` 后下一次构建会给它加上签名。**换密钥**（旧密钥还在）：运行 `npx fuyu-plugin keys rotate`，把它打印的新条目（带 `endorsedBy`，旧密钥的证明）加在 `signingKeys` 里旧密钥的后面，开 PR；CI 会核对证明。合并后用新密钥签名发版，用户的岛屿会自动接受新密钥。旧密钥可以留一段时间再删。**丢了旧密钥**或想停用签名：开 PR 直接换掉或删掉，维护者核实身份后才合并，之后的第一个更新每个用户都要手动确认。

## 发布新版本

在你的仓库发布新的 Release 即可，不需要再开 PR。本仓库定时检查，用同样的规则校验后更新索引。定时任务名义上每小时一次，但 GitHub 不保证准点，实际通常几小时一次，偶尔超过 10 小时；用户的岛屿再每 6 小时查一次市场，所以新版本到用户那里一般要半天左右。

以下情况新版本**不会自动上架**，会开一个 `review-needed` issue 等维护者审核：

- 申请了新的权限；
- 第一次加入自定义网页界面（webview 页面）；
- 运行时变了（例如从 Node.js 改成 exe）；
- 附件和标签处的源码不一致（见「与源码一致」）。

审核通过后，维护者在 `plugins/<id>.json` 里写上 `"approved": "<版本>"`，下一次构建就会上架。

已经上架的版本不能替换：同一个版本号的 zip 内容变了会被拒绝，请发新版本号。

## 下架与问题报告

发现插件有问题，请用 issue 模板「报告插件问题」。维护者可以把版本写进 `revoked.json`：已安装的岛屿会在下次刷新市场时停用（`disable`）或卸载（`uninstall`）它。

## 第 3 版插件（`.fuyu`）

第 3 版插件名字是 `@<作用域>/<名字>`，包是 `.fuyu`。**不用发 Release**：你给出提交号，市场从源码构建、审核，再发到本仓库的 Releases。开发说明见 [浮屿插件文档](https://github.com/TixXin/fuyu/tree/main/docs/plugins)。

> `fuyu-plugin` 2.0 还没发到 npm，下面的 `npx fuyu-plugin` 在那之前换成 `node <TixXin/fuyu 的检出>/packages/plugin-cli/bin/fuyu-plugin.mjs`；在本仓库里 `npm run tools -- --install` 会把市场用的那个版本检出到 `.tools/fuyu/`。

1. 只做一次：`npx fuyu-plugin keygen`，记下它打印的公钥 `{ "keyId", "publicKey" }`。私钥留在你自己的电脑上。
2. 在你的仓库提交并推送要发布的版本：
   - `package.json` 的 `name`、`version` 是这个版本，`repository` 指向这个仓库；
   - 有依赖时必须提交 `package-lock.json`（`lockfileVersion` 2 或 3），依赖只能来自 `registry.npmjs.org` 并带 `sha512` 校验，不能是 git、本地路径或别的 lockfile。市场用 `npm ci --ignore-scripts` 安装，不跑安装脚本，你的 `.npmrc` 不生效；
   - 本地可以先 `npx fuyu-plugin check --market` 和 `npx fuyu-plugin review <上一版的提交> <这次的提交>`，看到的就是 PR 上的报告。
3. `npx fuyu-plugin sign --commit <提交号>`，把它打印的 `version`、`repository`、`commit`、`authorSignature` 四项作为一行记录；`name` 和 `publicKey` 不用抄，公钥只在第一次写进 `authorKeys`。
4. 开 PR，新增或修改**一个文件** `plugins/v3/<作用域>/<名字>.json`：

```json
{
  "name": "@someone/weather",
  "path": "plugins/weather",
  "authorKeys": [{ "keyId": "…", "publicKey": "…" }],
  "versions": [
    { "version": "1.0.0", "repository": "https://github.com/someone/fuyu-weather", "commit": "<40 位提交号>", "authorSignature": { "keyId": "…", "signature": "…" } }
  ]
}
```

   - 作用域是仓库所有者（GitHub 账号或组织）的小写，`@someone/weather` 放在 `plugins/v3/someone/weather.json`；你必须拥有这个仓库，或是那个组织的公开成员。`@fuyu/*` 留给官方插件。
   - `path` 是插件在仓库里的文件夹，插件在仓库根目录时不写。
   - 发新版本：在 `versions` 末尾加一行。已经上架的行不能改也不能删；作者密钥只能加不能删（删要找维护者）。
   - 换作者密钥时，新密钥最好带旧密钥签的 `endorsedBy` 证明；没有证明的新密钥会在报告里标出来，岛屿会把它当成换了作者，要用户确认两次。
5. PR 检查在没有任何密钥、只读权限的任务里，按提交号取你的源码，用固定版本的工具和市场的构建设置构建，再和上一个上架的版本对比，把审核报告贴在 PR 上：
   - 🟢 绿：和上一版比没有值得注意的变化，维护者看一眼就能批准；
   - 🟡 黄：多了权限、网络地址、子进程这类变化，报告逐条列出，维护者要看过源码再批准；
   - 🔴 红：不会上架。改好后发新提交、新版本号再提交。
   - 本仓库的协作者给**自己已上架的插件**发新版本，PR 只改了自己作用域下的提交文件，计划里没有任何要人看的变化（首次上架、新的或删掉的密钥、换仓库、换文件夹、紧急、删版本），每个版本和上一版比都是 🟢 绿：检查通过后由 `Approve routine v3 updates` 自动批准，作者自己合入。批准只认检查过的那个提交，再推送会撤销。
   - 维护者写进 `market/v3/trusted-authors.json` 的信任作者，自己作用域的首次上架和 🟡 黄档也自动批准；换密钥、换仓库或文件夹仍要维护者批。
6. 维护者批准并合入后，市场重新构建这个版本，发到本仓库的 Releases（标签 `v3.<作用域>.<名字>@<版本>`，附件是 `.fuyu`、图标和截图），几分钟后签名的 `index.v3.json` 更新。岛屿在上架 3 天后才自动更新到它（冷静期）；维护者标了紧急的版本不等。

---

套装（`bundles/<id>.json`，市场页上「一次装上几个」的那一行）由维护者维护，目前只收官方插件，不接受第三方提交；想推荐一组搭配，开 issue 说明。

## English summary

1. Build your plugin with `npm create fuyu-plugin@latest`, check it with `npx fuyu-plugin validate`, and pack it with `npx fuyu-plugin pack`.
2. Publish a GitHub release in your repository: tag = manifest `version` (optionally prefixed with `v`), asset = `<id>-<version>.zip`.
3. Open a pull request here that adds only `plugins/<id>.json` (fields above). You must own `repo`, or be a public member of the organization that owns it. Ids containing `fuyu` or `focusd` are reserved.
   Optional: `path`, the folder of the plugin in the repository, where the market looks for `README.md` / `CHANGELOG.md` when the package leaves them out (shown in the market's details, 16 KB each, fixed per version).
4. Checks run automatically, including a scan for leaked credentials (tokens, API keys, private keys; a hit blocks the listing); a maintainer reads the source and merges. Merging rebuilds the index, so the plugin appears in the market within minutes.
   Optional author signing: `npx fuyu-plugin keygen` once and list the printed key as `"signingKeys"`, then `npx fuyu-plugin pack --sign` and attach `<zip>.sig` too. Only signed plugins update by themselves on users' islands, and an update signed by another key waits for each user's confirmation. With `signingKeys`, unsigned versions are never listed, approved or not.
   The release asset must hold the same files `fuyu-plugin pack` makes from your repository at the release tag (in `path`); a release with uncommitted or changed files fails the check, and an update like that waits for a maintainer. If the plugin needs a build step whose output is not committed (the TypeScript template), add `"buildStep": true` to skip the comparison.
   Optional "verified" mark: a GitHub organization with a verified domain gets it automatically; otherwise list `"domain": "example.com"` and serve `https://example.com/.well-known/focusd-publisher.json` with `{ "github": "<publisher>" }`.
5. New versions: just publish a new release. The index is rebuilt on a schedule that GitHub runs every few hours rather than every hour (sometimes over 10), and islands check the market every 6 hours, so expect about half a day. Updates that ask for new permissions, add a webview page, change the runtime or do not match the source at their tag wait for a maintainer, who approves them with `"approved": "<version>"`.

v3 plugins (`@scope/name`, `.fuyu` packages) need no release of your own: run `npx fuyu-plugin keygen` once, push the version to your repository (dependencies only from registry.npmjs.org, locked by `package-lock.json`; the market runs `npm ci --ignore-scripts`), run `npx fuyu-plugin sign --commit <sha>`, and open a pull request that adds its `version`, `repository`, `commit` and `authorSignature` as one line of `versions` in `plugins/v3/<scope>/<name>.json` (scope = the lowercase owner of the repository, which you must own). The check builds that commit with pinned tools and no secrets, compares it with the last listed version and posts a green, yellow or red report; red is never listed. Once a maintainer approves and merges, the market rebuilds it, publishes it to this repository's releases and signs `index.v3.json`; islands update to it by themselves 3 days later.

Bundles (`bundles/<id>.json`, the sets the market page installs in one go) are kept by the maintainers and hold only official plugins for now; they are not open to submissions. To suggest one, open an issue.

## 提交主题 / Submit a theme

主题只描述岛屿长什么样，不含尺寸和布局，也不运行代码，所以不需要发 Release，也不需要签名。开一个 pull request，只新增 `themes/<id>.json`：

```json
{
  "id": "yourname.dusk",
  "name": { "zh-CN": "黄昏", "en": "Dusk" },
  "description": { "zh-CN": "一句话说明（可省略）", "en": "One line (optional)" },
  "author": "your-github-login",
  "appearance": {
    "appearanceMode": "classic",
    "islandBackgroundColor": "#1b1020",
    "pulseColor": "#ff9a5a",
    "islandCornerRadius": 24
  }
}
```

- `id`：3–64 个小写字母、数字、点或连字符，文件名必须是 `<id>.json`。
- `author` 必须是你自己的 GitHub 账号；别人的主题只有原作者能改。
- `appearance` 只能有这些字段：`appearanceMode`（`classic` / `liquidGlass`）、`fontFamily`（`system` / `pixel`）、`glassIntensity`（25–100）、`opacity`（50–100）、`topFilletRadius`（0–12）、`islandCornerRadius`（16–40）、`islandCornerShape`（`squircle` / `round`）、`taskTextColor`、`pulseColor`、`islandBackgroundColor`（`#rrggbb`）、`pulseBrightness`（50–160）。没写的字段保持用户自己的设置。
- 最简单的办法：在岛屿的 设置 → 主题 里调好，导出主题文件，把里面的 `appearance` 抄过来。

PR 检查会校验格式和作者；合并后 `themes.json` 自动更新，岛屿的 设置 → 主题市场 下次打开就能看到。

