# PCなしでAyniを使う

現在の `http://<PCのIP>:5173/` はPCから配信しているため、PCの電源を切ると開けません。GitHub Pagesに置くと、PCの電源や自宅のWi-Fiに関係なく開けます。GitHubアカウントがあれば別サービスへの登録は不要です。

## 先に曲をバックアップする

スマホで現在のアプリを開き、各曲の「データ編集」→「JSONを書き出す」で修正したデータを保存してください。「JSONをコピー」も使えます。保存した曲はURLごとに管理されるため、新しい公開URLには自動では移りません。

## GitHub Pagesへ公開する

1. GitHubで `ayni-practice` などのリポジトリを作成します。GitHub Freeで無料公開する場合は **Public** を選びます。アプリのコードとデモ曲が公開されます。
2. アプリのソースと `.github/workflows/pages.yml` をリポジトリのmainブランチに入れます。端末に取り込んだ楽曲JSONやtest-resultsは入れません。
3. リポジトリの **Settings → Pages → Build and deployment → Source** で **GitHub Actions** を選びます。
4. mainへの変更、または **Actions → Publish Ayni to GitHub Pages → Run workflow** で公開します。自動テストが通った後、公開用distだけを配置します。
5. Settings → Pagesの **Visit site** で公開URLを確認します。URLは `https://<GitHubユーザー名>.github.io/<リポジトリ名>/` です。
6. スマホのChromeでそのURLを開きます。アプリの利用にはGitHubへのログインは不要です。

初回設定が済めば、アプリを使うたびにGitHubの操作をする必要はありません。

参考： [GitHub Pagesの概要・利用プラン](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)、[公開設定の公式手順](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。

Actionsを使わずファイルを手動で置く場合は、distの中身（index.htmlが最上位にある構成）と空の `.nojekyll` をリポジトリに入れます。SourceをDeploy from a branch、main / (root)に設定します。ZIPそのものをGitHubにアップロードしてもアプリは起動しません。

## スマホに入れてオフラインでも使う

1. 公開URLでアプリ上部の「オフライン対応」を確認します。初回はインターネット接続が必要です。
2. Chromeのメニューの「ホーム画面に追加」または「アプリをインストール」を選びます。
3. 「曲を追加」から、バックアップしたJSONを読み込みます。
4. PCの電源を切り、スマホでアプリを開いて再生してみます。
5. スマホを機内モードにしてアプリを閉じ、もう一度ホーム画面から開いて再生できることを確認します。

アプリのコードとオリジナルのデモ曲だけをホスティングに置きます。読み込んだ曲や編集した音符はスマホ内に保存し、サーバーへ送信しません。ブラウザーデータを消すと曲やオフラインキャッシュが消えるため、楽曲JSONは別に保管してください。

## アプリを更新する

**同じGitHubリポジトリ**のmainブランチを更新すると、テストと再公開が自動で動きます。毎回新しいリポジトリを作ると保存先URLが変わります。

スマホでは開いているAyniのタブとアプリをすべて閉じ、インターネットに接続して開き直します。Service Workerの更新時には開発側で `sw.js` のCACHE名を変更します。音符・曲進行を修正して保存するだけなら公開し直す必要はありません。
