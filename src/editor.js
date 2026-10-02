import { normalizeSong, beatsForMeter, meterText, emptyMeasureSummary, navigationLabel } from './format.js';
import { validateSong } from './validator.js';
import { parseSong } from './parser.js';
import { buildSequence } from './navigation.js';

const clone = value => JSON.parse(JSON.stringify(value));
const roleNames = { front: '前', back: '後', both: '両方', unknown: '未設定' };
const pitchParts = pitch => /^([A-G])([#b]?)(-1|[0-9])$/.exec(pitch || 'C4')?.slice(1) ?? ['C', '', '4'];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export class DataEditor {
  constructor({ root, player, getBpm, onSave, toast }) {
    this.root = root; this.player = player; this.getBpm = getBpm; this.onSave = onSave; this.toast = toast;
    this.filter = 'all'; this.selected = null; this.reviewFlow = false; this.dirty = false;
    root.addEventListener('click', event => this.onClick(event));
    root.addEventListener('change', event => this.onChange(event));
    root.addEventListener('input', event => this.onInput(event));
  }
  load(data) { this.data = normalizeSong(data); this.selected = this.data.measures[0]?.number; this.filter = 'all'; this.reviewFlow = false; this.dirty = false; this.render(); }
  current() { return this.data?.measures.find(m => m.number === this.selected); }
  validation() { return validateSong(this.data); }
  effectiveMeter(index) { let meter = this.data.defaultTimeSignature; for (let i = 0; i <= index; i++) if (this.data.measures[i].timeSignature) meter = this.data.measures[i].timeSignature; return meter; }
  flags(measure) {
    return { review: measure.needsReview || !measure.events.length || measure.events.some(e => e.needsReview || e.type === 'note' && e.role === 'unknown'), unknown: measure.events.some(e => e.type === 'note' && e.role === 'unknown'), empty: measure.events.length === 0 };
  }
  visibleMeasures() {
    return this.data.measures.filter(measure => { const f = this.flags(measure); return this.filter === 'all' || this.filter === 'review' && f.review || this.filter === 'unknown' && f.unknown || this.filter === 'empty' && f.empty; });
  }
  render() {
    const validation = this.cachedValidation = this.validation(), emptyWarning = emptyMeasureSummary(this.data);
    this.root.innerHTML = `
      ${emptyWarning ? `<div class="editor-alert"><strong>音符データが不足しています</strong><span>${esc(emptyWarning)}</span></div>` : ''}
      <div class="editor-toolbar">
        <div><span class="eyebrow accent">CHECK &amp; CORRECT</span><h2>楽曲データの確認・修正</h2></div>
        <div class="editor-actions"><button data-action="copy-json">JSONをコピー</button><button data-action="export-json">JSONを書き出す</button></div>
      </div>
      <details class="validation-details"><summary>検証結果：エラー ${validation.errors.length}件・警告 ${validation.warnings.length}件</summary><ul>${validation.issues.map(i=>`<li>${esc(i.message)}</li>`).join('')}</ul></details><div class="editor-layout">
        <aside class="editor-measures">
          <div class="editor-filter" role="group" aria-label="小節フィルター">
            ${[['all','すべて'],['review','要確認のみ'],['unknown','未設定roleあり'],['empty','空のeventsあり']].map(([value,label]) => `<button data-filter="${value}" class="${this.filter===value?'active':''}">${label}</button>`).join('')}
          </div>
          <button class="review-flow-button" data-action="review-flow">要確認のみ確認</button>
          <div class="editor-measure-list">${this.renderMeasureList()}</div>
        </aside>
        <div class="editor-detail">${this.renderDetail()}</div>
      </div>
      <section class="navigation-editor"><div class="panel-heading"><div><h2>曲進行</h2><p class="panel-description">小節番号と記号を修正し、演奏順を確認できます。</p></div><button data-action="add-navigation">＋ 記号</button></div><div class="navigation-list">${this.renderNavigation()}</div><div class="nav-preview"><div class="panel-heading"><h3>演奏順プレビュー</h3><span>${this.renderNavStatus()}</span></div><div class="route-list">${this.renderRoutePreview()}</div></div></section>
      <div class="editor-savebar"><span>${this.dirty ? '未保存の変更があります' : `エラー ${validation.errors.length}件・警告 ${validation.warnings.length}件`}</span><button data-action="save" class="play-button">保存</button></div>`;
  }
  renderMeasureList() {
    const visible = this.visibleMeasures();
    if (!visible.length) return '<p class="empty-filter">該当する小節はありません。</p>';
    return visible.map(measure => { const f = this.flags(measure), warning = f.review || f.unknown || f.empty; return `<button data-measure="${measure.number}" class="${measure.number===this.selected?'active':''}"><strong>${measure.number}</strong>${warning?'<span>⚠ 要確認</span>':'<span>確認済み</span>'}${f.empty?'<small>音符データなし</small>':''}</button>`; }).join('');
  }
  renderDetail() {
    const measure = this.current(); if (!measure) return '<p>小節がありません。</p>';
    const index = this.data.measures.indexOf(measure), meter = this.effectiveMeter(index), expected = measure.beats ?? beatsForMeter(meter), total = measure.events.reduce((sum,event)=>sum+(Number(event.duration)||0),0), delta = total-expected;
    return `<div class="editor-detail-head"><div><span class="eyebrow">MEASURE ${index+1} / ${this.data.measures.length}</span><h2>小節 ${measure.number}</h2></div><label class="review-checkbox"><input type="checkbox" data-measure-field="needsReview" ${measure.needsReview?'checked':''}>要確認</label></div>
      <div class="measure-meta"><label>拍子 <input data-measure-field="timeSignature" value="${esc(measure.timeSignature?meterText(measure.timeSignature):'')}" placeholder="継承 ${meterText(meter)}" inputmode="numeric"></label><span>現在 ${meterText(meter)}</span></div>
      <div class="editor-audition"><button data-action="previous-measure" aria-label="前の小節へ">←</button><button data-audition="current" class="primary">▶ この小節を試聴</button><button data-action="next-measure" aria-label="次の小節へ">→</button><p>BPM ${this.getBpm()}（練習画面で変更） <button data-action="stop">■ 停止</button><span id="audition-state" role="status"></span></p><div><button data-target="both">前後両方</button><button data-target="front">前だけ</button><button data-target="back">後だけ</button></div><details class="audition-more"><summary>周辺小節を試聴</summary><button data-audition="previous">▶ 前の小節から再生</button><button data-audition="next">▶ 次の小節まで再生</button><button data-audition="around">▶ 前後の3小節</button><button data-audition="from">▶ この小節から最後まで</button></details></div>
      <div class="event-list">${measure.events.length ? measure.events.map((event,i)=>this.renderEvent(event,i)).join('') : `<div class="empty-events"><strong>${measure.number}小節：音符データがありません</strong><span>空のeventsは休符として再生されません。音符または休符を追加してください。</span></div>`}</div>
      <div class="add-events"><button data-action="add-note">＋ 音符</button><button data-action="add-rest">＋ 休符</button></div>
      <div class="beat-check ${Math.abs(delta)<.000001?'ok':'warning'}"><strong>拍数：${Number(total.toFixed(4))} / ${Number(expected.toFixed(4))}</strong><span>${Math.abs(delta)<.000001?'✓ 一致':`${Number(Math.abs(delta).toFixed(4))}拍${delta<0?'不足':'超過'}（警告）`}</span></div>
      <div class="measure-confirm"><button data-action="confirm-measure">確認済みにする</button></div>`;
  }
  renderEvent(event, index) {
    const [letter, accidental, octave] = pitchParts(event.pitch), rest = event.type === 'rest';
    return `<article class="event-card" data-event="${index}"><div class="event-card-head"><strong>${index+1}. ${rest?'REST':esc(event.pitch)}</strong><div><button data-move="up" aria-label="上へ">↑</button><button data-move="down" aria-label="下へ">↓</button><button data-action="delete-event" aria-label="削除">削除</button></div></div>
      <div class="event-type"><label>種類</label><select data-event-field="type"><option value="note" ${!rest?'selected':''}>音符</option><option value="rest" ${rest?'selected':''}>休符</option></select><label class="review-checkbox"><input type="checkbox" data-event-field="needsReview" ${event.needsReview?'checked':''}>要確認</label></div>
      ${rest?'':`<div class="pitch-picker"><label>音名</label><div>${'CDEFGAB'.split('').map(v=>`<button data-pitch-part="letter" data-value="${v}" class="${letter===v?'active':''}">${v}</button>`).join('')}</div><label>変化記号</label><div>${[['b','♭'],['','♮'],['#','♯']].map(([v,l])=>`<button data-pitch-part="accidental" data-value="${v}" class="${accidental===v?'active':''}">${l}</button>`).join('')}</div><label>オクターブ</label><div>${[3,4,5,6].map(v=>`<button data-pitch-part="octave" data-value="${v}" class="${String(octave)===String(v)?'active':''}">${v}</button>`).join('')}</div><label>直接入力 <input data-event-field="pitch" value="${esc(event.pitch)}" inputmode="text"></label></div>`}
      <div class="duration-picker"><label>音価</label><input type="number" min="0.0078125" step="0.125" data-event-field="duration" value="${event.duration}" inputmode="decimal"><div>${[[4,'全'],[2,'2分'],[1,'4分'],[.5,'8分'],[.25,'16分'],[1.5,'付点4分'],[.75,'付点8分']].map(([v,l])=>`<button data-duration="${v}" class="${Number(event.duration)===v?'active':''}">${l}</button>`).join('')}</div></div>
      ${rest?'':`<div class="role-picker"><label>担当</label>${Object.entries(roleNames).map(([v,l])=>`<button data-role="${v}" class="${event.role===v?'active':''}">${l}</button>`).join('')}</div>`}</article>`;
  }
  renderNavigation() {
    if (!this.data.navigation.length) return '<p class="empty-filter">曲進行の記号はありません。</p>';
    return this.data.navigation.map((nav,index) => { const range = nav.type==='repeat'||nav.type==='ending'; return `<article data-navigation="${index}" class="navigation-row"><select data-nav-field="type">${['segno','coda','toCoda','dalSegno','daCapo','fine','repeat','ending'].map(v=>`<option value="${v}" ${nav.type===v?'selected':''}>${navigationLabel(v)}</option>`).join('')}</select>${range?`<label>開始 <input type="number" data-nav-field="startMeasure" value="${nav.startMeasure??''}" inputmode="numeric"></label><label>終了 <input type="number" data-nav-field="endMeasure" value="${nav.endMeasure??''}" inputmode="numeric"></label>`:`<label>小節 <input type="number" data-nav-field="measure" value="${nav.measure??''}" inputmode="numeric"></label>`}${nav.type==='ending'?`<label>括弧 <select data-nav-field="number"><option value="1" ${nav.number===1?'selected':''}>1番</option><option value="2" ${nav.number===2?'selected':''}>2番</option></select></label>`:''}${nav.type==='repeat'?`<label>回数 <input type="number" min="2" max="16" data-nav-field="times" value="${nav.times??2}"></label>`:''}${['segno','coda','toCoda','dalSegno'].includes(nav.type)?`<label>${nav.type==='segno'||nav.type==='coda'?'ID':'移動先'} <input data-nav-field="${nav.type==='segno'||nav.type==='coda'?'id':'target'}" value="${esc(nav.id??nav.target??'default')}"></label>`:''}${['dalSegno','daCapo'].includes(nav.type)?`<label>動作 <select data-nav-field="mode"><option value="end" ${nav.mode==='end'?'selected':''}>最後まで</option><option value="alCoda" ${nav.mode==='alCoda'?'selected':''}>al Coda</option><option value="alFine" ${nav.mode==='alFine'?'selected':''}>al Fine</option></select></label>`:''}<label class="review-checkbox"><input type="checkbox" data-nav-field="needsReview" ${nav.needsReview?'checked':''}>要確認</label><button data-action="delete-navigation">削除</button></article>`; }).join('');
  }
  route() { try { const data=clone(this.data); data.measures.forEach(m=>{m.events=[];}); const runtime=parseSong(data); return { sequence:buildSequence(runtime.parts[0],{mode:'score'}), error:null }; } catch(error) { return { sequence:[], error:error.message }; } }
  renderNavStatus() { const result=this.route(); return result.error?'進行を確認できません':`${result.sequence.length}小節`; }
  renderRoutePreview() { const result=this.route(); if(result.error) return `<span class="route-error">曲進行にループまたは設定不備の可能性があります：${esc(result.error)}</span>`; return result.sequence.slice(0,300).map((m,i)=>`${i?'<span class="route-arrow">→</span>':''}<span class="route-step">${m.number}</span>`).join('')+(result.sequence.length>300?'<span>…</span>':''); }
  markDirty() { this.dirty=true; this.cachedValidation=null; const status=this.root.querySelector('.editor-savebar span'); if(status)status.textContent='未保存の変更があります'; }
  onInput(event) { if (event.target.matches('[data-event-field="duration"],[data-event-field="pitch"],[data-measure-field="timeSignature"],[data-nav-field]')) this.applyField(event.target,false); }
  onChange(event) { const input=event.target; this.applyField(input, input.tagName === 'SELECT'); if(input.tagName !== 'SELECT') this.refreshChecks(); }
  applyField(input, rerender) {
    const card=input.closest('[data-event]'), navRow=input.closest('[data-navigation]');
    if (card && input.dataset.eventField) { const event=this.current().events[Number(card.dataset.event)], field=input.dataset.eventField; event[field]=input.type==='checkbox'?input.checked:field==='duration'?Number(input.value):input.value; if(field==='type'){ if(input.value==='rest'){delete event.pitch;delete event.role;}else{event.pitch='C4';event.role='unknown';event.needsReview=true;} } this.markDirty(); if(rerender)this.render(); return; }
    if(input.dataset.measureField){ const field=input.dataset.measureField; this.current()[field]=input.type==='checkbox'?input.checked:field==='timeSignature'?(input.value?/^(\d+)\/(\d+)$/.test(input.value)?{numerator:Number(input.value.split('/')[0]),denominator:Number(input.value.split('/')[1])}:input.value:null):input.value; this.markDirty(); if(rerender)this.render(); return; }
    if(navRow&&input.dataset.navField){const nav=this.data.navigation[Number(navRow.dataset.navigation)],field=input.dataset.navField;nav[field]=input.type==='checkbox'?input.checked:['measure','startMeasure','endMeasure','number','times'].includes(field)?Number(input.value):input.value;if(field==='type'){for(const key of ['measure','startMeasure','endMeasure','number','times','id','target','mode'])delete nav[key];if(['repeat','ending'].includes(nav.type)){nav.startMeasure=this.data.measures[0]?.number;nav.endMeasure=this.data.measures.at(-1)?.number;if(nav.type==='repeat')nav.times=2;else nav.number=1;}else{nav.measure=this.selected;if(['segno','coda'].includes(nav.type))nav.id='default';if(['toCoda','dalSegno'].includes(nav.type))nav.target='default';if(['dalSegno','daCapo'].includes(nav.type))nav.mode='end';}}this.markDirty();if(rerender)this.render();}
  }
  refreshChecks() {
    this.cachedValidation=this.validation();
    const list=this.root.querySelector('.editor-measure-list'); if(list)list.innerHTML=this.renderMeasureList();
    const result=this.root.querySelector('.validation-details'); if(result)result.innerHTML='<summary>検証結果：エラー '+this.cachedValidation.errors.length+'件・警告 '+this.cachedValidation.warnings.length+'件</summary><ul>'+this.cachedValidation.issues.map(i=>'<li>'+esc(i.message)+'</li>').join('')+'</ul>';
    const beat=this.root.querySelector('.beat-check');
    if(beat){const m=this.current(),expected=m.beats??beatsForMeter(this.effectiveMeter(this.data.measures.indexOf(m))),total=m.events.reduce((sum,e)=>sum+(Number(e.duration)||0),0),delta=total-expected;beat.textContent='拍数：'+total+' / '+expected+(Math.abs(delta)<.000001?' ✓ 一致':' ⚠ '+Number(Math.abs(delta).toFixed(4))+'拍'+(delta<0?'不足':'超過'));beat.className='beat-check '+(Math.abs(delta)<.000001?'ok':'warning');}
    const meter=this.root.querySelector('.measure-meta>span');
    if(meter)meter.textContent='現在 '+meterText(this.effectiveMeter(this.data.measures.indexOf(this.current())));
    // Update the labels without replacing the focused input or its next button.
    for(const card of this.root.querySelectorAll?.('[data-event]') ?? []) {
      const index=Number(card.dataset.event),event=this.current().events[index];
      card.querySelector('.event-card-head strong').textContent=`${index+1}. ${event.type==='rest'?'REST':event.pitch}`;
      const [letter,accidental,octave]=pitchParts(event.pitch);
      for(const button of card.querySelectorAll('[data-pitch-part]'))button.classList.toggle('active',button.dataset.value==={letter,accidental,octave}[button.dataset.pitchPart]);
      for(const button of card.querySelectorAll('[data-duration]'))button.classList.toggle('active',Number(button.dataset.duration)===event.duration);
    }
    const route=this.root.querySelector('.route-list'); if(route)route.innerHTML=this.renderRoutePreview();
    const routeStatus=this.root.querySelector('.nav-preview .panel-heading>span'); if(routeStatus)routeStatus.textContent=this.renderNavStatus();
  }
  setPosition(position) { const status=this.root.querySelector('#audition-state'); if(status)status.textContent=position ? '試聴中：'+position.measure.number+'小節' : ''; }
  async audition(kind,target='both') {
    try {
      const at=this.data.measures.findIndex(m=>m.number===this.selected); let start=at,end=at;
      if(['previous','around'].includes(kind))start=Math.max(0,at-1);
      if(['next','around'].includes(kind))end=Math.min(this.data.measures.length-1,at+1);
      if(kind==='from')end=this.data.measures.length-1;
      const data=clone(this.data); data.navigation=[];data.markers=[];data.measures=data.measures.slice(start,end+1);data.defaultTimeSignature=this.effectiveMeter(start);
      const empty=data.measures.find(m=>!m.events.length); if(empty)throw new Error(empty.number+'小節：音符データがありません。音符または休符を入力してください。');
      const runtime=parseSong(data);
      await this.player.play(runtime.parts[0].measures,{bpm:this.getBpm(),target,countIn:0,metronome:false,loop:false});
    } catch(error){this.toast(error.message,true);}
  }
  onClick(event) {
    const button=event.target.closest('button'); if(!button)return;
    if(button.dataset.filter){this.filter=button.dataset.filter;this.render();return;}
    if(button.dataset.measure){this.player.stop();this.selected=Number(button.dataset.measure);this.render();return;}
    const action=button.dataset.action, measure=this.current(), card=button.closest('[data-event]'), index=card?Number(card.dataset.event):-1;
    if(button.dataset.audition){this.audition(button.dataset.audition,'both');return;} if(button.dataset.target){this.audition('current',button.dataset.target);return;}
    if(button.dataset.duration){measure.events[index].duration=Number(button.dataset.duration);this.markDirty();this.render();return;}
    if(button.dataset.role){measure.events[index].role=button.dataset.role;if(button.dataset.role==='unknown')measure.events[index].needsReview=true;this.markDirty();this.render();return;}
    if(button.dataset.pitchPart){const eventItem=measure.events[index],parts=pitchParts(eventItem.pitch),map={letter:0,accidental:1,octave:2};parts[map[button.dataset.pitchPart]]=button.dataset.value;eventItem.pitch=parts.join('');this.markDirty();this.render();return;}
    if(button.dataset.move){const next=index+(button.dataset.move==='up'?-1:1);if(next>=0&&next<measure.events.length){[measure.events[index],measure.events[next]]=[measure.events[next],measure.events[index]];this.markDirty();this.render();}return;}
    if(action==='add-note'){measure.events.push({type:'note',pitch:'C4',duration:1,role:'unknown',needsReview:true});measure.needsReview=true;this.markDirty();this.render();}
    if(action==='add-rest'){measure.events.push({type:'rest',duration:1,needsReview:false});this.markDirty();this.render();}
    if(action==='delete-event'){measure.events.splice(index,1);this.markDirty();this.render();}
    if(action==='stop'){this.player.stop();this.setPosition(null);return;}
    if(action==='previous-measure'||action==='next-measure'){const at=this.data.measures.indexOf(measure)+(action==='previous-measure'?-1:1);if(this.data.measures[at]){this.player.stop();this.selected=this.data.measures[at].number;this.render();}return;}
    if(action==='confirm-measure'){
      if(!measure.events.length||measure.events.some(e=>e.type==='note'&&e.role==='unknown')||this.validation().errors.some(e=>e.measure===measure.number)){this.toast('空のevents・未設定の担当・入力エラーを修正してから確認済みにしてください。',true);return;}
      measure.needsReview=false;measure.events.forEach(item=>item.needsReview=false);this.markDirty();
      if(this.reviewFlow){const next=this.data.measures.find(m=>this.flags(m).review);if(next)this.selected=next.number;else{this.reviewFlow=false;this.toast(this.data.navigation.some(n=>n.needsReview)?'小節の確認は完了しました。曲進行に要確認項目が残っています。':'要確認項目はありません。');}}this.render();
    }
    if(action==='review-flow'){const next=this.data.measures.find(m=>this.flags(m).review);if(next){this.reviewFlow=true;this.selected=next.number;this.filter='review';this.render();}else this.toast(this.data.navigation.some(n=>n.needsReview)?'小節の要確認項目はありません。曲進行を確認してください。':'要確認項目はありません。');}
    if(action==='add-navigation'){this.data.navigation.push({type:'segno',measure:this.selected,id:'default',needsReview:true});this.markDirty();this.render();}
    if(action==='delete-navigation'){this.data.navigation.splice(Number(button.closest('[data-navigation]').dataset.navigation),1);this.markDirty();this.render();}
    if(action==='save'){const result=this.validation();if(result.errors.length){this.toast(`保存できません：${result.errors[0].message}`,true);return;}try{this.onSave(clone(result.song));this.dirty=false;this.render();this.toast('編集内容を保存しました。');}catch(error){this.toast(error.message,true);}}
    if(action==='export-json')this.exportJson(); if(action==='copy-json')this.copyJson();
  }
  filename(){const base=`${this.data.title}_${this.data.part.id||this.data.part.name}`.normalize('NFKD').replace(/[^\w\-]+/g,'_').replace(/^_+|_+$/g,'').toLowerCase();return `${base||'ayni_song'}.json`;}
  exportJson(){if(!this.checkExport())return;const blob=new Blob([JSON.stringify(this.data,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=this.filename();a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  checkExport(){const result=this.validation();if(result.errors.length){this.toast('JSONを出力できません：'+result.errors.map(e=>e.message).join(' / '),true);return false;}return true;}
  async copyJson(){if(!this.checkExport())return;const json=JSON.stringify(this.data,null,2);try{await navigator.clipboard.writeText(json);this.toast('JSONをクリップボードへコピーしました。');}catch{let fallback=this.root.querySelector('.json-fallback');if(!fallback){fallback=document.createElement('label');fallback.className='json-fallback';fallback.textContent='長押しして、すべて選択 → コピーしてください。';const area=document.createElement('textarea');area.readOnly=true;area.setAttribute('aria-label','書き出しJSON');fallback.append(area);this.root.append(fallback);}const area=fallback.querySelector('textarea');area.value=json;area.focus();area.select();this.toast('自動コピーが利用できないため、JSONを表示しました。');}}
}
