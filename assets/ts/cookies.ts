interface ConsentState {
    necessary: boolean;
    analytics: boolean;
    functional: boolean;
    timestamp: number;
}

class CookieConsent {
    private static COOKIE_NAME = 'cookie_consent';
    private static COOKIE_DAYS = 365;

    private state: ConsentState | null = null;
    private banner: HTMLElement | null = null;
    private settingsPanel: HTMLElement | null = null;

    constructor() {
        this.banner = document.getElementById('cookie-consent-banner');
        this.settingsPanel = document.getElementById('cookie-settings-panel');

        this.state = this.loadState();

        if (!this.state && this.banner) {
            this.showBanner();
        }

        this.bindEvents();
        this.dispatchConsentEvent();
    }

    private loadState(): ConsentState | null {
        const cookie = document.cookie
            .split('; ')
            .find(row => row.startsWith(CookieConsent.COOKIE_NAME + '='));

        if (!cookie) return null;

        try {
            return JSON.parse(decodeURIComponent(cookie.split('=')[1]));
        } catch {
            return null;
        }
    }

    private saveState(): void {
        if (!this.state) return;

        const expires = new Date();
        expires.setDate(expires.getDate() + CookieConsent.COOKIE_DAYS);

        document.cookie = `${CookieConsent.COOKIE_NAME}=${encodeURIComponent(JSON.stringify(this.state))}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;
    }

    private showBanner(): void {
        if (this.banner) {
            this.banner.removeAttribute('aria-hidden');
        }
    }

    private hideBanner(): void {
        if (this.banner) {
            // Blur any focused element inside the banner before hiding
            const activeElement = document.activeElement as HTMLElement;
            if (activeElement && this.banner.contains(activeElement)) {
                activeElement.blur();
            }
            this.banner.setAttribute('aria-hidden', 'true');
        }
        this.hideSettings();
    }

    private showSettings(): void {
        if (this.settingsPanel) {
            this.settingsPanel.removeAttribute('aria-hidden');

            // Restore checkbox states from current state or defaults
            const checkboxes = this.settingsPanel.querySelectorAll('input[data-cookie-category]');
            checkboxes.forEach((cb) => {
                const input = cb as HTMLInputElement;
                const category = input.dataset.cookieCategory as keyof ConsentState;
                if (category && this.state && typeof this.state[category] === 'boolean') {
                    input.checked = this.state[category] as boolean;
                } else {
                    input.checked = false;
                }
            });
        }
    }

    private hideSettings(): void {
        if (this.settingsPanel) {
            // Blur any focused element inside the settings panel before hiding
            const activeElement = document.activeElement as HTMLElement;
            if (activeElement && this.settingsPanel.contains(activeElement)) {
                activeElement.blur();
            }
            this.settingsPanel.setAttribute('aria-hidden', 'true');
        }
    }

    private bindEvents(): void {
        document.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const action = target.dataset.cookieAction;

            if (!action) return;

            switch (action) {
                case 'accept':
                    this.acceptAll();
                    break;
                case 'deny':
                    this.denyAll();
                    break;
                case 'settings':
                    this.showSettings();
                    break;
                case 'save':
                    this.saveSettings();
                    break;
                case 'cancel':
                    this.hideSettings();
                    break;
                case 'reopen':
                    this.showBanner();
                    break;
                // michael.gr: [Claude] the "Reset" button of the settings panel (see banner.html).
                case 'reset':
                    this.resetAll();
                    break;
            }
        });
    }

    private acceptAll(): void {
        this.state = {
            necessary: true,
            analytics: true,
            functional: true,
            timestamp: Date.now()
        };
        this.saveState();
        this.hideBanner();
        this.dispatchConsentEvent();
    }

    private denyAll(): void {
        this.state = {
            necessary: true,
            analytics: false,
            functional: false,
            timestamp: Date.now()
        };
        this.saveState();
        this.hideBanner();
        this.dispatchConsentEvent();
    }

    private saveSettings(): void {
        const checkboxes = document.querySelectorAll('input[data-cookie-category]');

        this.state = {
            necessary: true,
            analytics: false,
            functional: false,
            timestamp: Date.now()
        };

        checkboxes.forEach((cb) => {
            const input = cb as HTMLInputElement;
            const category = input.dataset.cookieCategory as keyof ConsentState;
            if (category && category in this.state!) {
                (this.state as any)[category] = input.checked;
            }
        });

        this.saveState();
        this.hideBanner();
        this.dispatchConsentEvent();
    }

    // michael.gr: [Claude] Delete every cookie of the site that JavaScript can see, the consent cookie included, and reload the page.
    // [Claude] Google Analytics sets its cookies on a parent domain (e.g. `.michael.gr`), and a cookie is deleted only by the same domain it was set with, so each cookie is expired on the host and on every parent domain.
    // [Claude] Third-party cookies (e.g. IntenseDebate) belong to other domains, so they cannot be deleted from here.
    // [Claude] The reload unloads analytics and comments that the old consent had loaded, and shows the banner again, since there is no consent cookie anymore.
    private resetAll(): void {
        const hostParts = location.hostname.split('.');
        const domains = [''];
        for (let i = 0; i < hostParts.length - 1; i++) {
            domains.push('; domain=.' + hostParts.slice(i).join('.'));
        }
        const names = document.cookie.split('; ').map(row => row.split('=')[0]).filter(name => name);
        for (const name of names) {
            for (const domain of domains) {
                document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}`;
            }
        }
        location.reload();
    }

    private dispatchConsentEvent(): void {
        // Cross-module event consumed by consent-gated features (for example commentsConsent.ts).
        const event = new CustomEvent('onCookieConsentChange', {
            detail: this.state
        });
        window.dispatchEvent(event);

        // Set data attributes on document for CSS-based control
        if (this.state) {
            document.documentElement.dataset.consentAnalytics = String(this.state.analytics);
            document.documentElement.dataset.consentFunctional = String(this.state.functional);
        }
    }

    // Public API
    public hasConsent(category: keyof Omit<ConsentState, 'timestamp'>): boolean {
        if (!this.state) return false;
        return this.state[category] ?? false;
    }

    public getState(): ConsentState | null {
        return this.state;
    }

    public reopenBanner(): void {
        this.showBanner();
    }
}

// Export for module usage
export default CookieConsent;

// Initialize when DOM is ready and expose globally
declare global {
    interface Window {
        cookieConsent: CookieConsent;
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.cookieConsent = new CookieConsent();
    });
} else {
    window.cookieConsent = new CookieConsent();
}
