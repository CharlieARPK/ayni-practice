# Ayni 楽曲JSON仕様 1.0

正式定義は `src/schema.js` の `SONG_SCHEMA`。`song.schema.json` は `npm run schema` で同じ定義から生成します。インポートと保存はこのSchemaで構造を検証し、`src/validator.js` で参照先・重複・拍数を検証します。JavaScript製アプリですが、型の補助定義 `src/types.d.ts` にSongData / Measure / NoteEvent / RestEvent / NavigationEventを用意しています。

## 完全な例

これは形式説明用の音符で、実際のCondor canquiの採譜ではありません。

```json
{
  "formatVersion": "1.0",
  "title": "Condor canqui",
  "bpm": 90,
  "part": { "id": "tyo", "name": "Tyo", "instrument": "Toyo" },
  "key": "G",
  "defaultTimeSignature": { "numerator": 4, "denominator": 4 },
  "markers": [],
  "navigation": [],
  "measures": [
    {
      "number": 55,
      "timeSignature": null,
      "events": [
        { "type": "note", "pitch": "G3", "duration": 0.5, "role": "front", "needsReview": false },
        { "type": "note", "pitch": "A3", "duration": 0.5, "role": "back", "needsReview": false },
        { "type": "rest", "duration": 0.5, "needsReview": false },
        { "type": "note", "pitch": "B3", "duration": 1.5, "role": "both", "needsReview": false },
        { "type": "rest", "duration": 1, "needsReview": false }
      ],
      "needsReview": false
    }
  ]
}
```

## 基本フィールド

- formatVersionは `"1.0"`。未知の版は拒否します。
- titleは空ではない曲名、最大200文字。bpmは四分音符基準で30〜240。
- part.id / name / instrumentは空ではない文字列。1ファイル1パート。画面にはpart.nameをそのまま表示します。
- keyは表示用の調。調号から自動補正しません。実音の臨時記号をpitchに記載します。
- defaultTimeSignatureの分子は1〜32、分母は1/2/4/8/16/32。
- markersはセクションの配列。例 `{"measure":55,"label":"A","id":"section-a"}`。idは任意です。
- measuresは1〜5000小節。numberは正の整数で重複なし・昇順。31からなどの抜粋や欠番も使用できます。
- 小節timeSignatureのnullは直前の拍子（最初は標準）を継承。変更時は `{"numerator":6,"denominator":8}` 等を指定し、以後も継承します。
- 小節sectionは任意のセクション名。明確な弱起には任意のbeatsで実際の拍数を指定できます。

## イベント

eventsは演奏順。開始位置はdurationの累積です。和音・同時発音には未対応です。

| 音価 | duration |
|---|---:|
| 全音符 | 4 |
| 2分音符 | 2 |
| 4分音符 | 1 |
| 8分音符 | 0.5 |
| 16分音符 | 0.25 |
| 付点4分音符 | 1.5 |
| 付点8分音符 | 0.75 |

durationは有限の正数。6/8は3拍、9/8は4.5拍。拍数不一致は警告で保存できます。試聴時は不足分を未入力の無音時間とし、超過分は切り捨てず最後まで再生して次小節へ進みます。JSONに休符を自動挿入しません。

note.pitchは `C3`, `F#4`, `Bb5` のような英字音名＋任意の#またはb＋オクターブ。画面のボタンは3〜6、直接入力・再生範囲はC-1〜G9です。keyから補正しません。

| role | 担当 | 再生 |
|---|---|---|
| front | 前 | 前だけ／両方 |
| back | 後 | 後だけ／両方 |
| both | 両方 | どの選択でも発音 |
| unknown | 未設定 | 発音せず要確認 |

restにはpitch/roleは不要。イベントと小節のneedsReviewはboolean。空eventsは「音符データなし」であり休符に変換しません。練習では無音で時間が進みますが、編集試聴では入力を促します。

## 曲進行（navigation）

位置は小節番号。Segno/Codaは小節頭、To Coda/D.S./D.C./Fine/反復終了は小節の演奏後に作用します。

| type | 必須の位置フィールド | 任意フィールド |
|---|---|---|
| segno | measure | id |
| coda | measure | id |
| toCoda | measure | target（Codaのid） |
| dalSegno | measure | target（Segnoのid）, mode |
| daCapo | measure | mode |
| fine | measure | — |
| repeat | startMeasure, endMeasure | times（2〜16、標準2） |
| ending | startMeasure, endMeasure, number | — |

すべてにneedsReview:trueを付けられます。id/target省略時は `"default"`。同種の記号IDは重複不可。modeは `"alCoda"`, `"alFine"`, `"end"`（標準）。ending.numberは1番括弧=1、2番括弧=2（最大16）。範囲は両端を含みます。同じ範囲に異なるnumberのendingを置くと共通括弧になります。

```json
[
  { "type": "segno", "measure": 33, "id": "s1" },
  { "type": "toCoda", "measure": 79, "target": "c1", "needsReview": true },
  { "type": "dalSegno", "measure": 116, "target": "s1", "mode": "alCoda", "needsReview": true },
  { "type": "coda", "measure": 117, "id": "c1" },
  { "type": "fine", "measure": 123 },
  { "type": "repeat", "startMeasure": 90, "endMeasure": 97, "times": 2 },
  { "type": "ending", "startMeasure": 96, "endMeasure": 97, "number": 1 },
  { "type": "ending", "startMeasure": 98, "endMeasure": 99, "number": 2 }
]
```

指定番号の小節はmeasuresに必要です。例示の位置を実際の楽譜に合わせてください。

区間練習では記号を無視。楽譜どおりでは初回To Codaを通過し、D.S./D.C. al Coda実行後だけCodaへ移動します。戻った後は反復を省略し最後の括弧を採用。Fineはal Fineで戻った後に有効です。ジャンプは一度のみ、過剰な展開・不整合は停止し警告します。演奏順プレビューは全曲経路の先頭300小節を表示します。

## 検証・旧形式

構造エラー、pitch/role/duration不正、番号重複、参照先のない曲進行は具体的なメッセージで拒否。空events・unknown・needsReview・拍数不一致は警告として保存でき、編集で修正できます。音符・位置を推測しません。

旧形式のdefaultTempo→bpm、parts[0]→part、score.key→key、score.timeSignature→defaultTimeSignature、notes→events、player→role、rest:true→type:restを変換します。文字列拍子、各小節のnavigation/repeat/ending、repeatStructures、timeSignatureChangesにも対応します。複数partsはパート別の曲一覧項目に分け、全パートを保持。保存済み旧ライブラリの移行時はayni.library.before-format-1.0に元データを一度バックアップします。

旧JSONの省略されたroleはunknown、確認フラグはfalse（unknownはtrue）、キーは空文字、拍子は4/4を既定値とします。パート情報不足時には表示用の既定値を使います。新規JSON生成時は省略せず正式仕様に従ってください。source/note/confidence等の追加情報も保持します。

## ChatGPTへの依頼文

song.schema.jsonと楽譜画像を渡し、次のように依頼できます。

> 添付のAyni SongData 1.0 JSON Schemaに適合するJSONを1パートにつき1ファイルで作成してください。part.nameは楽譜のパート名をそのまま使用。durationは四分音符=1、pitchは調号・臨時記号を反映した実音。休符はtype:rest、不明な担当はrole:unknownかつneedsReview:true。判読できない小節はevents:[]かつneedsReview:trueとし、音符や休符を推測して埋めないでください。D.S./Coda等の位置が不確実ならneedsReview:true。拍子変更・反復・括弧・セクション・小節番号を保持し、参照先が存在することを検証してください。
