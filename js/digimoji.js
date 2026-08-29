// js/digimoji.js
// Conversione fonetica italiano -> Hiragana ("Digimoji") usata nelle chat: le tre tabelle di
// digrammi/trigrammi (HIRA3/HIRA2/HIRA1), la funzione pura di conversione, e l'helper che collega
// la conversione live a una coppia textarea+checkbox. Nessuna dipendenza da session/roster/scena
// -- attachDigimojiInput tocca solo gli elementi DOM i cui id gli vengono passati come parametro,
// non variabili globali dell'app -- quindi e' un'estrazione a rischio basso quanto util.js/dice.js,
// anche se e' un file di feature (con binding DOM) invece di sola logica.
//
// Script classico (non un modulo ES), caricato PRIMA del blocco <script> principale in index.html
// -- restano funzioni/costanti globali esattamente come quando vivevano nella stessa IIFE del
// file grande, nessun cambiamento di comportamento.

  // ---------- DIGIMOJI: conversione fonetica italiana -> Hiragana ----------
  // Regole pensate per l'ortografia italiana (ca/co/cu = k, che/chi = k, ci = "chi",
  // ga/go/gu = g, ghe/ghi = g, gi = "ji", sci = "shi"), più le varianti standard
  // (romaji "wapuro": ti/tu/si/hu/zi come alternative a chi/tsu/shi/fu/ji).
  const HIRA3 = {chi:'き',che:'け',ghi:'ぎ',ghe:'げ',sci:'し',tsu:'つ',shi:'し'};
  const HIRA2 = {
    ka:'か',ki:'き',ku:'く',ke:'け',ko:'こ',
    ca:'か',co:'こ',cu:'く',ci:'ち',
    sa:'さ',si:'し',su:'す',se:'せ',so:'そ',
    ta:'た',ti:'ち',te:'て',to:'と',tu:'つ',
    na:'な',ni:'に',nu:'ぬ',ne:'ね',no:'の',
    ha:'は',hi:'ひ',hu:'ふ',fu:'ふ',he:'へ',ho:'ほ',
    ma:'ま',mi:'み',mu:'む',me:'め',mo:'も',
    ya:'や',yu:'ゆ',yo:'よ',
    ra:'ら',ri:'り',ru:'る',re:'れ',ro:'ろ',
    wa:'わ',wo:'を',
    ga:'が',gu:'ぐ',go:'ご',gi:'じ',
    za:'ざ',zu:'ず',ze:'ぜ',zo:'ぞ',zi:'じ',ji:'じ',
    da:'だ',de:'で',do:'ど',di:'ぢ',du:'づ',
    ba:'ば',bi:'び',bu:'ぶ',be:'べ',bo:'ぼ',
    pa:'ぱ',pi:'ぴ',pu:'ぷ',pe:'ぺ',po:'ぽ',
    va:'ば',vi:'び',vu:'ぶ',ve:'べ',vo:'ぼ', // Japanese has no native "v" sound; approximated on the b-row
  };
  const HIRA1 = {a:'あ',i:'い',u:'う',e:'え',o:'お',n:'ん'};

  function italianToHiragana(text){
    let out = '';
    let lower = String(text||'').toLowerCase();
    // Sokuon (small tsu): a doubled consonant becomes っ + the single consonant,
    // e.g. "addo" -> "aっdo", matching how Japanese renders gemination in loanwords.
    lower = lower.replace(/([bcdfghjklmpqrstvwxyz])\1/g, 'っ$1');
    let i = 0;
    while(i < lower.length){
      const c3 = lower.substr(i,3);
      const c2 = lower.substr(i,2);
      const c1 = lower.substr(i,1);
      if(c3.length===3 && HIRA3[c3]){ out += HIRA3[c3]; i+=3; continue; }
      if(c2.length===2 && HIRA2[c2]){ out += HIRA2[c2]; i+=2; continue; }
      if(HIRA1[c1]){ out += HIRA1[c1]; i+=1; continue; }
      out += lower[i]; i+=1;
    }
    return out;
  }

  // Collega la conversione live a una textarea + checkbox "Digimoji".
  // Converte una parola non appena viene completata (spazio/punteggiatura/a capo),
  // evitando l'ambiguità della "n" (es. "montana" convertita lettera per lettera
  // rischierebbe di leggere "n" come ん prima di sapere se segue una vocale).
  function attachDigimojiInput(taId, chkId){
    const ta = document.getElementById(taId);
    const chk = document.getElementById(chkId);
    if(!ta || !chk) return;
    function convertWordBeforeBoundary(){
      const val = ta.value;
      const pos = ta.selectionStart == null ? val.length : ta.selectionStart;
      if(pos===0) return;
      const justTyped = val[pos-1];
      if(/[a-zA-Z]/.test(justTyped)) return; // parola non ancora conclusa
      let start = pos-2;
      while(start>=0 && /[a-zA-Z]/.test(val[start])) start--;
      start++;
      const wordEnd = pos-1;
      if(start>=wordEnd) return;
      const word = val.slice(start, wordEnd);
      const converted = italianToHiragana(word);
      if(converted===word) return;
      ta.value = val.slice(0,start) + converted + val.slice(wordEnd);
      const newPos = start + converted.length + (pos - wordEnd);
      try{ ta.setSelectionRange(newPos, newPos); }catch(e){}
    }
    function convertAllNow(){
      if(!chk.checked) return;
      const pos = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
      const convertedBefore = italianToHiragana(ta.value.slice(0,pos));
      ta.value = italianToHiragana(ta.value);
      const newPos = convertedBefore.length;
      try{ ta.setSelectionRange(newPos, newPos); }catch(e){}
    }
    ta.addEventListener('input', ()=>{ if(chk.checked) convertWordBeforeBoundary(); });
    ta.addEventListener('blur', convertAllNow);
    chk.addEventListener('change', ()=>{ if(chk.checked) convertAllNow(); });
    // Passata di sicurezza: converte per intero (anche l'ultima parola rimasta
    // a metà) subito prima dell'invio effettivo del messaggio.
    ta.dataset.digimojiFinalize = 'true';
  }
