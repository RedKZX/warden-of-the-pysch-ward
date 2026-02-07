class ColorManager {
    static colors = {
        reset: '\x1b[0m',
        cyan: '\x1b[38;2;0;255;255m',          // Electric cyan
        blue: '\x1b[38;2;41;121;255m',         // Bright blue
        green: '\x1b[38;2;57;255;136m',        // Neon green
        yellow: '\x1b[38;2;255;247;69m',       // Sunny yellow
        orange: '\x1b[38;2;255;159;69m',       // Bright orange
        red: '\x1b[38;2;255;71;87m',           // Hot red
        purple: '\x1b[38;2;187;107;255m',      // Vibrant purple
        pink: '\x1b[38;2;255;107;255m',        // Hot pink
        
        brackets: '\x1b[38;2;87;87;87m',       // Dark gray
        timestamp: '\x1b[38;2;169;169;169m',   // Light gray
        
        cyanMessage: '\x1b[38;2;0;210;210m',
        blueMessage: '\x1b[38;2;41;140;255m',
        greenMessage: '\x1b[38;2;57;210;136m',
        yellowMessage: '\x1b[38;2;210;203;57m',
        orangeMessage: '\x1b[38;2;210;131;57m',
        redMessage: '\x1b[38;2;210;59;71m',
        purpleMessage: '\x1b[38;2;154;88;210m',
        pinkMessage: '\x1b[38;2;210;88;210m'
    };

    static formatLogMessage(type, message) {
        const timestamp = new Date().toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        const { color, messageColor } = this.getColors(type);
        const c = this.colors;

        const formattedType = type.padEnd(8);
        
        return `${c.brackets}[${c.timestamp}${timestamp}${c.brackets}] [${color}${formattedType}${c.brackets}] ${messageColor}${message}${c.reset}`;
    }

    static getColors(type) {
        const typeColors = {
            System: {
                color: this.colors.green,
                messageColor: this.colors.greenMessage
            },
            Error: {
                color: this.colors.red,
                messageColor: this.colors.redMessage
            },
            Warning: {
                color: this.colors.orange,
                messageColor: this.colors.orangeMessage
            },
            Command: {
                color: this.colors.blue,
                messageColor: this.colors.blueMessage
            },
            Event: {
                color: this.colors.purple,
                messageColor: this.colors.purpleMessage
            },
            Database: {
                color: this.colors.cyan,
                messageColor: this.colors.cyanMessage
            },
            API: {
                color: this.colors.yellow,
                messageColor: this.colors.yellowMessage
            },
            Component: {
                color: this.colors.pink,
                messageColor: this.colors.pinkMessage
            },
            Dashboard: {
                color: this.colors.pink, 
                messageColor: this.colors.pinkMessage
            },
            Startup: {
                color: this.colors.cyan,
                messageColor: this.colors.cyanMessage
            },
            Cache: {
                color: this.colors.blue,
                messageColor: this.colors.blueMessage
            },
            Interaction: {
                color: this.colors.green,
                messageColor: this.colors.greenMessage
            },
            Info: {
                color: this.colors.blue,
                messageColor: this.colors.blueMessage
            },
            Debug: {
                color: this.colors.purple,
                messageColor: this.colors.purpleMessage
            },
            Success: {
                color: this.colors.green,
                messageColor: this.colors.greenMessage
            },
            Prefix: {
                color: this.colors.yellow,
                messageColor: this.colors.yellowMessage
            },
            Count: {
                color: this.colors.purple,
                messageColor: this.colors.purpleMessage
            }
        };

        return typeColors[type] || {
            color: this.colors.timestamp,
            messageColor: this.colors.timestamp
        };
    }
}

module.exports = ColorManager;
