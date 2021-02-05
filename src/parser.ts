import * as fs from "fs/promises";

export class NginxParseTreeNode {
    public name: string;
    public value: string;
    public parent: NginxParseTreeNode | null;
    public readonly children: NginxParseTreeNode[] | null;
    public readonly comments: string[] = [];
    public isVerbatim = false;
    public isBlock = false;

    public constructor(
        name: string,
        value: string | number | null,
        parent: NginxParseTreeNode | null,
        children?: NginxParseTreeNode[] | null
    ) {
        this.name = name;
        this.value = (value || "").toString();
        this.parent = parent;
        this.children = children || [];
        this.isBlock = !!children;
    }
}

export class NginxParseError extends Error {
    index: number;
    line: number;

    constructor(opts: { message: string; line: number; index: number }) {
        super(opts.message);
        this.index = opts.index;
        this.line = opts.line;
    }
}

export class NginxParser {
    private source = "";
    private index = -1;
    private context: NginxParseTreeNode | null = null;
    private tree: NginxParseTreeNode | null = null;
    private error: NginxParseError | null = null;

    public constructor() {
        this.source = "";
        this.index = -1;
        this.tree = null;
        this.context = null;
        this.error = null;
    }

    public parse(source: string): Promise<NginxParseTreeNode> {
        return new Promise<NginxParseTreeNode>((resolve, reject) => {
            this.source = source;
            this.index = 0;
            this.tree = new NginxParseTreeNode("[root]", "", null, []);
            this.context = new NginxParseTreeNode("", null, this.tree);
            this.error = null;

            do {
                this.parseNext();
                if (this.error) return reject(this.error);
            } while (this.index < this.source.length);

            if (this.error) reject(this.error);
            else resolve(this.tree);
        });
    }

    private setError(message: string): void {
        const line =
            (this.source.substring(0, this.index).match(/\n/g) || []).length +
            1;

        this.error = new NginxParseError({
            message: message,
            index: this.index,
            line: line,
        });
    }

    private parseNext(): void {
        if (!this.context) throw new Error("context was not initialized");

        const c = this.source.charAt(this.index);
        let value: string;

        if (!c) return;

        switch (c) {
            case "{":
            case ";":
                this.context.value = this.context.value.trim();
                if (!this.context.parent)
                    throw new Error("context.parent does not exist");

                if (!Array.isArray(this.context.parent.children))
                    throw new Error("context.parent.children is not an array");

                this.context.parent.children.push(this.context);

                if (
                    c === "{" &&
                    this.context.name &&
                    /_by_lua_block$/.test(this.context.name)
                ) {
                    //special handling of lua blocks: they are not treated as a regular "block", which would
                    //have child directives and stuff. lua "blocks" are just lua code surrounded by "{ }".
                    if (this.context.value) {
                        //there's already a value set, that means something is weird (pretty sure this is invalid...)
                        //basically the "lol" in something like this: content_by_lua_block lol { echo 'hello' }
                        this.setError(
                            "Already a value set for Lua block (alert nginx-conf developers if your syntax is valid)"
                        );
                        break;
                    }

                    this.context.value = this.readVerbatimBlock();
                    this.context.isVerbatim = true;
                    this.context = new NginxParseTreeNode(
                        "",
                        null,
                        this.context.parent
                    );
                } else {
                    if (c === "{") this.context.isBlock = true;

                    //new context is child of current context, or a sibling to the parent
                    this.context = new NginxParseTreeNode(
                        "",
                        null,
                        c === "{" ? this.context : this.context.parent
                    );
                }

                this.index++;
                break;
            case "}":
                //new context is sibling to the parent
                if (!this.context.parent)
                    throw new Error("context.parent does not exist");

                this.context = new NginxParseTreeNode(
                    "",
                    null,
                    this.context.parent.parent
                );
                this.index++;
                break;
            case "\n":
            case "\r":
                if (this.context.value) this.context.value += c;

                this.index++;
                break;
            case "'":
            case '"':
                if (!this.context.name) this.context.name = this.readString();
                else this.context.value += this.readString();

                break;
            case "#":
                this.context.comments.push(this.readComment());
                break;
            default:
                value = this.readWord();
                const trimmedValue = value.trim();
                if (trimmedValue === "#") {
                    // if value starts with whitespace and encounters a "#", we're at a comment.
                    // we can't delimit words by "#" because comments can only appear outside of directives.
                    // http://nginx.org/en/docs/beginners_guide.html#conf_structure
                    this.index--;
                    break;
                }
                if (!this.context.name) {
                    this.context.name = value.trim();
                    //read trailing whitespace
                    const ws = /^\s*/.exec(this.source.substring(this.index));
                    if (ws) this.index += ws[0].length;
                } else this.context.value += value;

                break;
        }
    }

    public readString(): string {
        const delimiter = this.source.charAt(this.index);
        let value = delimiter;
        for (let i = this.index + 1; i < this.source.length; i++) {
            if (this.source.charAt(i) === "\\") {
                value += this.source.charAt(i) + this.source.charAt(i + 1);
                i++;
                continue;
            }
            if (this.source.charAt(i) === delimiter) {
                value += delimiter;
                break;
            }

            value += this.source.charAt(i);
        }

        if (value.length < 2 || value.charAt(value.length - 1) !== delimiter) {
            this.setError(
                "Unable to parse quote-delimited value (probably an unclosed string)"
            );
            return "";
        }
        this.index += value.length;
        return value;
    }

    public readWord(): string {
        let result = /^(.+?)[\s;{}'"]/.exec(this.source.substring(this.index));
        if (!result) {
            this.setError("Word not terminated. Are you missing a semicolon?");
            return "";
        }
        this.index += result[1].length;

        let word = result[1];
        if (word[word.length - 1] === "$" && this.source[this.index] === "{") {
            // interpolated variable, e.g. ${foo}, read until "}"
            result = /^(.+?})/.exec(this.source.substring(this.index));
            if (!result) {
                this.setError(
                    'Expected closing bracket "}" for interpolated variable'
                );
                return word;
            }

            word += result[1];
            this.index += result[1].length;
            // if the current char is not whitespace, ";" or "{", there is more to the word
            if (!/[\s{;]/.test(this.source[this.index]))
                word += this.readWord();
        }

        return word;
    }

    public readComment(): string {
        const result = /(.*?)(?:\r\n|\n|$)/.exec(
            this.source.substring(this.index)
        );
        this.index += result ? result[0].length : 0;
        return result ? result[1].substring(1) : ""; // ignore # character
    }

    public readVerbatimBlock(): string {
        //can't just use regex because it has to count the number of matching {}
        //NOTE: this will break for lua comments that contain "{" or "}"
        let openingBrackets = 0;
        let closingBrackets = 0;
        let current: string;
        let result = "";

        while ((current = this.source.charAt(this.index))) {
            switch (current) {
                case "}":
                    closingBrackets++;
                    break;
                case "{":
                    openingBrackets++;
                    break;
            }

            result += current;
            this.index++;

            if (openingBrackets === closingBrackets) break;
        }

        if (openingBrackets !== closingBrackets) {
            this.setError(
                "Verbatim bock not terminated. Are you missing a closing curly bracket?"
            );
            return "";
        }

        return result.replace(/^{/, "").replace(/}$/, "");
    }

    public async parseFile(
        file: string,
        encoding: BufferEncoding = "utf8"
    ): Promise<NginxParseTreeNode> {
        const contents = await fs.readFile(file, { encoding });

        return await this.parse(contents);
    }
}
