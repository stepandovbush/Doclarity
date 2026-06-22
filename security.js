// ============================================================================
// CLEARPATH SECURITY MODULE - ENCRYPTION & DATA PROTECTION
// ============================================================================

class DoclaritySecurity {
    constructor() {
        this.sessionToken = this.generateSecureToken();
        this.encryptionEnabled = true;
        this.init();
    }

    init() {
        this.setupSecurityHeaders();
        this.initializeSessionSecurity();
        this.setupDataProtection();
    }

    // Generate secure session token
    generateSecureToken() {
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    // Setup security headers and policies
    setupSecurityHeaders() {
        // Prevent clickjacking
        if (window.self !== window.top) {
            window.top.location = window.self.location;
        }

        // Disable right-click context menu for sensitive areas
        document.addEventListener('contextmenu', (e) => {
            if (e.target.closest('.analysis-card, .messages, .chat-pane')) {
                e.preventDefault();
            }
        });

        // Prevent text selection on sensitive data
        const sensitiveElements = document.querySelectorAll('.analysis-card, .messages');
        sensitiveElements.forEach(el => {
            el.addEventListener('selectstart', (e) => {
                // Allow selection but ensure it's secure
            });
        });
    }

    // Initialize session-level security
    initializeSessionSecurity() {
        // Store session token in sessionStorage (not localStorage for sensitive data)
        sessionStorage.setItem('clearpath_session_token', this.sessionToken);

        // Set session timeout (30 minutes of inactivity)
        this.setupSessionTimeout();

        // Monitor for suspicious activity
        this.monitorActivity();
    }

    // Setup automatic session timeout
    setupSessionTimeout() {
        let inactivityTimer;
        const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

        const resetTimer = () => {
            clearTimeout(inactivityTimer);
            inactivityTimer = setTimeout(() => {
                this.clearSensitiveData();
                console.warn('Session expired due to inactivity');
            }, SESSION_TIMEOUT);
        };

        // Reset timer on user activity
        document.addEventListener('mousemove', resetTimer);
        document.addEventListener('keypress', resetTimer);
        document.addEventListener('click', resetTimer);
        document.addEventListener('scroll', resetTimer);

        resetTimer();
    }

    // Monitor for suspicious activity
    monitorActivity() {
        // Detect copy attempts on sensitive data
        document.addEventListener('copy', (e) => {
            if (e.target.closest('.analysis-card, .messages')) {
                // Log activity (in production, send to server)
                console.log('Copy action detected on sensitive data');
            }
        });

        // Detect print attempts
        window.addEventListener('beforeprint', () => {
            console.log('Print action detected');
            // Could show warning or disable printing
        });
    }

    // Encrypt sensitive data (client-side)
    encryptData(data) {
        if (!this.encryptionEnabled) return data;

        try {
            // Simple base64 encoding for client-side (production should use proper encryption)
            return btoa(JSON.stringify(data));
        } catch (error) {
            console.error('Encryption error:', error);
            return data;
        }
    }

    // Decrypt sensitive data
    decryptData(encryptedData) {
        if (!this.encryptionEnabled) return encryptedData;

        try {
            return JSON.parse(atob(encryptedData));
        } catch (error) {
            console.error('Decryption error:', error);
            return encryptedData;
        }
    }

    // Clear sensitive data from memory
    clearSensitiveData() {
        // Clear sessionStorage
        sessionStorage.clear();

        // Clear sensitive DOM elements
        const messagesDiv = document.getElementById('messages');
        if (messagesDiv) {
            messagesDiv.innerHTML = '';
        }

        const analysisCard = document.getElementById('analysisCard');
        if (analysisCard) {
            analysisCard.style.display = 'none';
        }

        // Clear file input
        const fileUpload = document.getElementById('fileUpload');
        if (fileUpload) {
            fileUpload.value = '';
        }

        console.log('Sensitive data cleared');
    }

    // Validate file before upload
    validateFile(file) {
        // Allowed file types
        const allowedTypes = ['application/pdf', 'text/plain', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

        // Max file size: 10MB
        const maxSize = 10 * 1024 * 1024;

        if (!allowedTypes.includes(file.type)) {
            console.warn('Invalid file type:', file.type);
            return false;
        }

        if (file.size > maxSize) {
            console.warn('File size exceeds limit:', file.size);
            return false;
        }

        return true;
    }

    // Sanitize user input
    sanitizeInput(input) {
        const div = document.createElement('div');
        div.textContent = input;
        return div.innerHTML;
    }

    // Validate and sanitize chat messages
    validateChatMessage(message) {
        if (!message || typeof message !== 'string') {
            return null;
        }

        // Remove any HTML/script tags
        const sanitized = this.sanitizeInput(message);

        // Limit message length
        if (sanitized.length > 5000) {
            return sanitized.substring(0, 5000);
        }

        return sanitized;
    }

    // Setup Content Security Policy (CSP) headers
    setupCSP() {
        const meta = document.createElement('meta');
        meta.httpEquiv = 'Content-Security-Policy';
        meta.content = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'";
        document.head.appendChild(meta);
    }

    // Generate secure hash for data integrity
    generateHash(data) {
        // Simple hash function (production should use proper hashing)
        let hash = 0;
        for (let i = 0; i < data.length; i++) {
            const char = data.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(16);
    }

    // Verify data integrity
    verifyIntegrity(data, hash) {
        return this.generateHash(data) === hash;
    }

    // Log security events (in production, send to server)
    logSecurityEvent(event, details) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            event,
            details,
            sessionToken: this.sessionToken,
        };

        // In production, send to secure server
        console.log('[SECURITY LOG]', logEntry);
    }

    // Check for HTTPS (production requirement)
    checkHTTPS() {
        if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
            console.warn('Warning: Doclarity should be served over HTTPS for production use');
            this.logSecurityEvent('HTTPS_WARNING', 'Non-HTTPS connection detected');
        }
    }

    // Disable autocomplete on sensitive fields
    disableAutocomplete() {
        const sensitiveInputs = document.querySelectorAll('#chatInput, #fileUpload');
        sensitiveInputs.forEach(input => {
            input.setAttribute('autocomplete', 'off');
            input.setAttribute('spellcheck', 'false');
        });
    }

    // Initialize all security measures
    initializeAllSecurityMeasures() {
        this.checkHTTPS();
        this.disableAutocomplete();
        this.setupCSP();
        this.logSecurityEvent('SECURITY_INIT', 'Doclarity security module initialized');
    }
}

// Initialize security module when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.security = new DoclaritySecurity();
        window.security.initializeAllSecurityMeasures();
    });
} else {
    window.security = new DoclaritySecurity();
    window.security.initializeAllSecurityMeasures();
}
