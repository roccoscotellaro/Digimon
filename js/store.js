// js/store.js
// Stato condiviso dell'app: la sessione loggata e tutte le cache che rispecchiano i dati del
// server (roster, scena, log, Digidex, registro NPC, combattimento, progressione, sottogruppi,
// missioni, log privati). Prima erano variabili private alla IIFE del vecchio index.html
// monolitico -- private a QUELLA funzione, quindi invisibili a qualunque script esterno. Qui
// sono dichiarate come variabili globali vere (script classico, non un modulo ES, caricato PRIMA
// del blocco <script> principale): index.html continua a leggerle e scriverle esattamente come
// prima (risalendo la catena di scope fino a qui), solo non le dichiara piu'.
//
// E' il prerequisito per estrarre in futuro moduli come combat.js: qualunque codice che debba
// leggere/scrivere cachedCombat, cachedRoster ecc. da FUORI quella IIFE ha bisogno che queste
// variabili vivano da qualche parte che entrambi i lati possano raggiungere -- qui.
//
// Non ci sono ancora getter/setter o un pattern piu' strutturato: sono le stesse identiche
// variabili mutabili di prima, solo spostate. Un modulo di stato "vero" (con un'unica funzione
// per aggiornarle, invece di assegnazioni sparse in giro per il file) e' un miglioramento
// possibile più avanti, ma cambierebbe anche il modo in cui index.html le scrive — un salto di
// rischio più alto, rimandato apposta.

let session = null;

let cachedRoster = [];
let cachedScene = { title:'', background:'', music:'' };
let cachedLog = [];
let cachedDex = [];
let cachedMe = null;
let cachedCombat = null;
let cachedProgression = null;
let cachedSubgroups = []; // sottogruppi della campagna, presi dal server (vedi refreshLiveParts) — non più da localStorage
let cachedMissions = [];
let cachedNpcs = [];
let cachedMasterPrivateLog = []; // ultimo log privato caricato nella vista "chat privata" del Master
let cachedSubgroupLog = [];
