// ============================================================
//  オンライン対戦の接続設定（フォークする場合はここを書き換える）
//  公開鍵（publishable key）はブラウザに配る前提の公開値。
//  使うのは Supabase Realtime の Broadcast と Presence のみ（テーブル・認証は不要）。
// ============================================================
export const SUPABASE_URL = 'https://ryqkdquyxztityoxeyge.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_Fswnf2NmO2a3MXcoKr_lTg_Mfml5gsH';
// オンラインに入ったときだけ動的 import する（ソロはネットワーク不要）
export const SUPABASE_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
// チャンネル名の名前空間（同じプロジェクトの他の用途と衝突させない）
export const CHANNEL_PREFIX = 'autochemyth:room:';
