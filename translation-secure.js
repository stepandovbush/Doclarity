// ============================================================================
// CLEARPATH - SECURE TRANSLATION SYSTEM
// Ensures translation accuracy and prevents accidental text alteration
// ============================================================================

class SecureTranslationManager {
    constructor() {
        this.currentLanguage = 'en';
        this.translations = translations || {};
        this.translationCache = {};
        this.validationRules = this.initializeValidationRules();
        this.init();
    }

    init() {
        this.setupLanguageListener();
        this.validateAllTranslations();
    }

    initializeValidationRules() {
        return {
            // Ensure key translations maintain meaning
            brand_name: { minLength: 3, maxLength: 50, type: 'text' },
            brand_subtitle: { minLength: 5, maxLength: 100, type: 'text' },
            hero_title: { minLength: 10, maxLength: 200, type: 'text' },
            hero_description: { minLength: 20, maxLength: 500, type: 'text' },
            chat_placeholder: { minLength: 5, maxLength: 50, type: 'text' },
            bot_greeting: { minLength: 20, maxLength: 300, type: 'text' },
            ai_summary_intro: { minLength: 10, maxLength: 100, type: 'text' },
            ai_action_1: { minLength: 10, maxLength: 150, type: 'text' },
            ai_timeline_deadline: { minLength: 10, maxLength: 150, type: 'text' },
            ai_recommendations_label: { minLength: 5, maxLength: 100, type: 'text' },
        };
    }

    validateAllTranslations() {
        const languages = Object.keys(this.translations);
        languages.forEach(lang => {
            const langTranslations = this.translations[lang];
            Object.keys(this.validationRules).forEach(key => {
                const rule = this.validationRules[key];
                const value = langTranslations[key];

                if (value) {
                    if (value.length < rule.minLength || value.length > rule.maxLength) {
                        console.warn(`Translation validation warning: ${lang}.${key} length is ${value.length}, expected ${rule.minLength}-${rule.maxLength}`);
                    }
                }
            });
        });
    }

    setupLanguageListener() {
        const languageSelect = document.getElementById('language');
        if (languageSelect) {
            languageSelect.addEventListener('change', (e) => {
                this.changeLanguage(e.target.value);
            });
        }
    }

    changeLanguage(languageCode) {
        // Validate language code
        if (!this.translations[languageCode]) {
            console.error(`Invalid language code: ${languageCode}`);
            return;
        }

        this.currentLanguage = languageCode;
        this.updateAllUIElements();
        this.updateChatbotLanguage();
    }

    updateAllUIElements() {
        // Update all elements with data-i18n attribute
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            const translation = this.getSecureTranslation(key);

            if (translation && translation !== key) {
                element.textContent = translation;
            }
        });

        // Update all elements with data-i18n-placeholder attribute
        document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
            const key = element.getAttribute('data-i18n-placeholder');
            const translation = this.getSecureTranslation(key);

            if (translation && translation !== key) {
                element.placeholder = translation;
            }
        });

        // Update aria-labels and other attributes
        document.querySelectorAll('[data-i18n-aria]').forEach(element => {
            const key = element.getAttribute('data-i18n-aria');
            const translation = this.getSecureTranslation(key);

            if (translation && translation !== key) {
                element.setAttribute('aria-label', translation);
            }
        });

        // Update title attributes
        document.querySelectorAll('[data-i18n-title]').forEach(element => {
            const key = element.getAttribute('data-i18n-title');
            const translation = this.getSecureTranslation(key);

            if (translation && translation !== key) {
                element.setAttribute('title', translation);
            }
        });
    }

    updateChatbotLanguage() {
        // Keep the existing conversation intact — the chatbot translates it in
        // place on language change instead of wiping it. Only sync status here.
        if (window.chatbot) {
            window.chatbot.currentLanguage = this.currentLanguage;
            window.chatbot.updateChatGreeting();
        }
    }

    getSecureTranslation(key) {
        // Check cache first
        const cacheKey = `${this.currentLanguage}_${key}`;
        if (this.translationCache[cacheKey]) {
            return this.translationCache[cacheKey];
        }

        // Get translation from translations object
        if (this.translations[this.currentLanguage] && this.translations[this.currentLanguage][key]) {
            const translation = this.translations[this.currentLanguage][key];

            // Validate translation
            if (this.validateTranslation(key, translation)) {
                this.translationCache[cacheKey] = translation;
                return translation;
            } else {
                console.warn(`Translation validation failed for ${this.currentLanguage}.${key}`);
                // Fall back to English
                if (this.translations['en'] && this.translations['en'][key]) {
                    return this.translations['en'][key];
                }
            }
        }

        // Return key if no translation found
        return key;
    }

    validateTranslation(key, translation) {
        // Check if translation is a string
        if (typeof translation !== 'string') {
            return false;
        }

        // Check if translation is not empty
        if (translation.trim().length === 0) {
            return false;
        }

        // Check validation rules if they exist
        if (this.validationRules[key]) {
            const rule = this.validationRules[key];
            if (translation.length < rule.minLength || translation.length > rule.maxLength) {
                return false;
            }
        }

        return true;
    }

    // Method to get translation for use in JavaScript code
    t(key) {
        return this.getSecureTranslation(key);
    }

    // Method to get all translations for a language
    getLanguageTranslations(languageCode) {
        return this.translations[languageCode] || {};
    }

    // Method to validate a specific translation
    validateSpecificTranslation(languageCode, key) {
        if (!this.translations[languageCode] || !this.translations[languageCode][key]) {
            return { valid: false, message: `Translation not found: ${languageCode}.${key}` };
        }

        const translation = this.translations[languageCode][key];
        if (!this.validateTranslation(key, translation)) {
            return { valid: false, message: `Translation validation failed for ${languageCode}.${key}` };
        }

        return { valid: true, message: 'Translation is valid', value: translation };
    }
}

// Initialize secure translation manager
let secureTranslationManager;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.i18n = new SecureTranslationManager();
    });
} else {
    window.i18n = new SecureTranslationManager();
}
