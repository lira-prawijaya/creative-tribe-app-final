export interface IframePrintOptions {
  title: string;
  bodyHtml: string;
  extraCss: string;
  onError?: (message: string) => void;
}

function collectDocumentStyles(): string {
  return Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
    .map((node) => {
      if (node.tagName.toLowerCase() === 'link') {
        const href = (node as HTMLLinkElement).href;
        return href ? `<link rel="stylesheet" href="${href}" />` : '';
      }
      return node.outerHTML;
    })
    .join('\n');
}

/**
 * Opens a dedicated clean tab via window.open('', '_blank'), writes standalone print HTML
 * via document.write, and triggers window.print() automatically once styles/images load.
 */
export function printHtmlInNewTab({
  title,
  bodyHtml,
  extraCss,
  onError,
}: IframePrintOptions): void {
  const printWin = window.open('', '_blank');
  if (!printWin) {
    onError?.(
      'Popup print diblokir oleh browser. Izinkan pop-up untuk situs ini lalu klik Print lagi.'
    );
    return;
  }

  const collectedStyles = collectDocumentStyles();
  const safeTitle = title.replace(/[<>&"']/g, '');

  const html = `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
    <base href="${window.location.origin}/" />
    ${collectedStyles}
    <style>
      ${extraCss}
    </style>
  </head>
  <body class="print-standalone-page">
    ${bodyHtml}
    <script>
      (function () {
        var printed = false;
        function runPrint() {
          if (printed) return;
          printed = true;
          try {
            window.focus();
            window.print();
          } catch (e) {}
        }
        function waitForAssetsAndPrint() {
          var imgs = Array.prototype.slice.call(document.images || []);
          var pending = imgs.filter(function (img) { return !img.complete; });
          if (pending.length === 0) {
            setTimeout(runPrint, 250);
            return;
          }
          var doneCount = 0;
          function onAssetDone() {
            doneCount += 1;
            if (doneCount >= pending.length) {
              setTimeout(runPrint, 200);
            }
          }
          pending.forEach(function (img) {
            img.addEventListener('load', onAssetDone, { once: true });
            img.addEventListener('error', onAssetDone, { once: true });
          });
          setTimeout(runPrint, 1800);
        }
        if (document.readyState === 'complete') {
          waitForAssetsAndPrint();
        } else {
          window.addEventListener('load', waitForAssetsAndPrint, { once: true });
          setTimeout(runPrint, 2200);
        }
      })();
    </script>
  </body>
</html>`;

  try {
    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();
  } catch {
    onError?.('Gagal menyiapkan halaman cetak di tab baru.');
  }
}

/**
 * Prints an HTML fragment via a hidden same-origin iframe instead of window.open,
 * avoiding popup blockers inside embedded iframes while preserving standalone A4 styles.
 */
export function printHtmlInHiddenIframe({
  title,
  bodyHtml,
  extraCss,
  onError,
}: IframePrintOptions): void {
  const collectedStyles = collectDocumentStyles();

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';

  const cleanup = () => {
    window.setTimeout(() => {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    }, 1000);
  };

  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentDocument ?? iframe.contentWindow?.document;
  const iframeWin = iframe.contentWindow;

  if (!iframeDoc || !iframeWin) {
    cleanup();
    try {
      window.print();
    } catch {
      onError?.('Gagal membuka dialog cetak / simpan PDF.');
    }
    return;
  }

  const safeTitle = title.replace(/[<>&"']/g, '');

  iframeDoc.open();
  iframeDoc.write(`<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
    <base href="${window.location.origin}/" />
    ${collectedStyles}
    <style>
      ${extraCss}
    </style>
  </head>
  <body>
    ${bodyHtml}
  </body>
</html>`);
  iframeDoc.close();

  const triggerPrint = () => {
    try {
      iframeWin.focus();
      iframeWin.print();
    } catch {
      try {
        window.print();
      } catch {
        onError?.('Gagal membuka dialog cetak / simpan PDF.');
      }
    } finally {
      cleanup();
    }
  };

  window.setTimeout(triggerPrint, 350);
}
