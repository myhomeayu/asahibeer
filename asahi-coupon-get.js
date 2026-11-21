// ==UserScript==
// @name         Asahi Coupon Auto Get
// @namespace    local.asahi.coupon
// @version      1.0.4
// @description  アサヒビールの当選結果画面からクーポン受領画面まで自動遷移
// @match        https://www.asahibeer-cp.jp/*
// @match        https://asahibeer.s-coupon.net/*
// @match        https://coupon.sej.co.jp/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==
// @updateURL    https://github.com/myhomeayu/asahibeer/raw/main/asahi-coupon-get.js
// @downloadURL  https://github.com/myhomeayu/asahibeer/raw/main/asahi-coupon-get.js

(() => {
    'use strict';
    const MESSAGE = 'アサヒビールLINE公式アカウント当選連絡の配信バナーをご確認ください。';
    const HOSTS = new Set(['www.asahibeer-cp.jp', 'asahibeer.s-coupon.net', 'coupon.sej.co.jp']);
    const log = message => console.log(`[Asahi Coupon] ${message}`);
    const nonempty = (url, key) => Boolean(url.searchParams.get(key)?.trim());
    // br・要素境界・全角空白等による表示上の区切りだけを無視する。
    // 文言自体は省略せず、全文の一致を引き続き必須とする。
    const normalizeMessage = text => text.replace(/[\s\u200B\uFEFF]+/gu, '');

    // URLオブジェクトでドメイン・パス・パラメータの存在を厳密に判定する。
    function classify(url) {
        if (url.protocol !== 'https:' || !HOSTS.has(url.hostname)
            || url.port || url.username || url.password) return null;
        if (url.hostname === 'www.asahibeer-cp.jp') return 'result';
        if (url.hostname === 'coupon.sej.co.jp') {
            return url.pathname === '/order/cpnsp_03.do' && nonempty(url, 'hansoku_id') ? 'final' : null;
        }
        if (!nonempty(url, 'sn')) return null;
        // 実画面の順序：案内 / → 利用確認 /confirm/ → 発券 /issue/。
        if (url.pathname === '/') return 'guide';
        if (url.pathname === '/issue/') return 'issue';
        return url.pathname === '/confirm/' ? 'confirm' : null;
    }

    const initial = new URL(window.location.href);
    const step = classify(initial);
    if (!step) return;
    log('スクリプト起動');
    // STEP 4：直接到達した場合も含め、最終画面には何も操作しない。
    if (step === 'final') {
        log('最終クーポンページに到達');
        log('自動処理終了');
        return;
    }
    // ドキュメント単位の重複防止。別ページや別の当選結果は妨げない。
    const guard = 'data-asahi-coupon-auto-started';
    if (document.documentElement.hasAttribute(guard)) return;
    document.documentElement.setAttribute(guard, 'true');
    let stopped = false;
    let clicked = false;
    let observer;
    let interval;
    let timeout;
    let winLogged = false;

    function stop(message) {
        if (stopped) return;
        stopped = true;
        observer?.disconnect();
        clearInterval(interval);
        clearTimeout(timeout);
        window.removeEventListener('load', start);
        window.removeEventListener('pagehide', onPageHide);
        log(message);
        log('自動処理終了');
    }
    function onPageHide() { stop('ページ遷移により監視終了'); }
    function visible(element) {
        const style = window.getComputedStyle(element);
        return element.isConnected && element.getClientRects().length > 0
            && style.display !== 'none' && style.visibility !== 'hidden'
            && style.visibility !== 'collapse' && !element.closest('[hidden], [inert]');
    }

    // STEP 1：画面に当選メッセージがある場合のみ、idでinputを取得する。
    function resultButton() {
        if (!normalizeMessage(document.body?.innerText || '').includes(normalizeMessage(MESSAGE))) {
            // 遅れて表示される結果も最大待機時間まで監視し、未検出時は操作しない。
            return null;
        }
        if (!winLogged) { winLogged = true; log('当選メッセージを検出'); }
        const button = document.getElementById('coupon');
        if (!button || button.tagName !== 'INPUT' || button.disabled || !visible(button)) return null;
        // 明示されたフォーム送信先が許可外なら拒否する。
        const action = button.getAttribute('formaction') || button.form?.getAttribute('action');
        if (action) {
            try {
                const url = new URL(action, document.baseURI);
                if (url.protocol !== 'https:' || !HOSTS.has(url.hostname)
                    || url.port || url.username || url.password) {
                    stop('許可されていないフォーム遷移先のため停止');
                    return null;
                }
            } catch { stop('フォーム遷移先の解析エラー'); return null; }
        }
        // 要実画面確認：couponのJavaScriptハンドラーによる遷移先は静的には検証できない。
        log('クーポン受領ボタンを検出');
        return button;
    }

    // STEP 2・3：実在するリンクだけを利用し、識別情報やURLを生成しない。
    function nextLink() {
        const candidates = [];
        for (const link of document.querySelectorAll('a[href]')) {
            try {
                const url = new URL(link.getAttribute('href'), document.baseURI);
                const target = classify(url);
                const confirmedIssue = step === 'confirm' && target === 'issue'
                    && url.searchParams.get('sn') === initial.searchParams.get('sn');
                // 戻るリンクは候補にしない。発券ページからconfirmへは戻らない。
                if (target === 'final'
                    || (step === 'guide' && target === 'confirm')
                    || confirmedIssue) candidates.push(link);
            } catch { /* 解析できないhrefは無視し、値はログに出さない。 */ }
        }
        if (candidates.length > 1) {
            stop('遷移候補が複数あるためクリックせず停止');
            return null;
        }
        const link = candidates[0];
        if (!link || !visible(link)) return null;
        // 要実画面確認：JS専用ボタンやフォームの意味は推測しない。
        // 明示的なonclick付きリンクも確認が必要。ページ自身の自動遷移は妨げない。
        if (link.hasAttribute('onclick') || link.getAttribute('aria-disabled') === 'true'
            || link.hasAttribute('download') || (link.target && link.target !== '_self')) {
            stop('対象リンクの動作は要実画面確認のため停止');
            return null;
        }
        return link;
    }

    function check() {
        if (stopped || clicked) return;
        try {
            // URLが変わった後に古いページ向けの操作を行わない。
            if (window.location.href !== initial.href) {
                stop(classify(new URL(window.location.href)) === 'final'
                    ? '最終クーポンページに到達' : 'URL変更を検出したため停止');
                return;
            }
            const element = step === 'result' ? resultButton() : nextLink();
            if (!element || stopped) return;
            // clickの直前にフラグを設定して監視を解除し、再入を防ぐ。
            clicked = true;
            stop(step === 'result' ? 'クーポン受領ボタンをクリック' : '確認できた遷移リンクをクリック');
            element.click();
        } catch {
            // 例外には固有パラメータが含まれる可能性があるため内容を出力しない。
            if (stopped) log('クリック処理エラーにより停止');
            else stop('処理エラーにより停止');
        }
    }

    function start() {
        if (stopped || observer) return;
        try {
            log(step === 'guide' ? 'クーポン案内ページを検出'
                : step === 'issue' ? 'クーポン発行ページを検出'
                : step === 'confirm' ? 'クーポン確認ページを検出' : '当選結果ページを確認');
            observer = new MutationObserver(check);
            observer.observe(document.documentElement, {
                childList: true, subtree: true, characterData: true, attributes: true,
                attributeFilter: ['href', 'id', 'disabled', 'hidden', 'style', 'class', 'aria-disabled'],
            });
            interval = setInterval(check, 250);
            check();
        } catch { stop('監視開始エラーにより停止'); }
    }
    window.addEventListener('pagehide', onPageHide);
    // loadが完了しない場合も含め、起動から最大30秒で停止する。
    timeout = setTimeout(() => stop('対象要素が見つからず停止（最大待機30秒）'), 30000);
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
})();
