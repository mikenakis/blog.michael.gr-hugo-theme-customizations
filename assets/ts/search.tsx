interface pageData {
    title: string,
    date: string,
    permalink: string,
    content: string,
    image?: string,
    preview: string,
    matchCount: number,
    titleMatchCount: number
}

interface match {
    start: number,
    end: number
}

/**
 * Escape HTML tags as HTML entities
 * Edited from:
 * @link https://stackoverflow.com/a/5499821
 */
const tagsToReplace = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '…': '&hellip;'
};

function replaceTag(tag: string) {
    return (tagsToReplace as Record<string, string>)[tag] || tag;
}

function replaceHTMLEnt(str: string) {
    return str.replace(/[&<>"]/g, replaceTag);
}

/* michael.gr: Removed "-" from the escaped characters, because the search regexes now carry the "u" flag, which rejects
   "\-" outside a character class as an invalid escape; outside a character class, "-" needs no escaping anyway. */
function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class Search {
    private data: pageData[];
    private form: HTMLFormElement;
    private input: HTMLInputElement;
    private list: HTMLDivElement;
    private resultTitle: HTMLHeadElement;
    private resultTitleTemplate: string;
    private container: HTMLDivElement;
    /* michael.gr: Added the "Whole words only" checkbox (see left.html). */
    private wholeWords: HTMLInputElement | null;
    /* michael.gr: Added the "Match: all / any word" radio buttons (see left.html); this is the "any word" one. */
    private anyWord: HTMLInputElement | null;

    constructor({ form, input, list, resultTitle, resultTitleTemplate }: {
        form: HTMLFormElement,
        input: HTMLInputElement,
        list: HTMLDivElement,
        resultTitle: HTMLHeadingElement,
        resultTitleTemplate: string
    }) {
        this.form = form;
        this.input = input;
        this.list = list;
        this.resultTitle = resultTitle;
        this.resultTitleTemplate = resultTitleTemplate;
        this.container = list.parentElement as HTMLDivElement;
        this.wholeWords = form.querySelector('input[name="whole"]');
        this.anyWord = form.querySelector('input[name="match"][value="any"]');

        /// Check if there's already value in the search input
        if (this.input.value.trim() !== '') {
            this.doSearch(this.input.value.split(' '));
        }
        else {
            this.handleQueryString();
        }

        this.bindQueryStringChange();
        this.bindSearchForm();
    }

    /**
     * Processes search matches
     * @param str original text
     * @param matches array of matches
     * @param ellipsis whether to add ellipsis to the end of each match
     * @param charLimit max length of preview string
     * @param offset how many characters before and after the match to include in preview
     * @returns preview string
     */
    private static processMatches(str: string, matches: match[], ellipsis: boolean = true, charLimit = 140, offset = 20): string {
        matches.sort((a, b) => {
            return a.start - b.start;
        });

        let i = 0,
            lastIndex = 0,
            charCount = 0;

        const resultArray: string[] = [];

        while (i < matches.length) {
            const item = matches[i];

            /// item.start >= lastIndex (equal only for the first iteration)
            /// because of the while loop that comes after, iterating over variable j

            if (ellipsis && item.start - offset > lastIndex) {
                resultArray.push(`${replaceHTMLEnt(str.substring(lastIndex, lastIndex + offset))} [...] `);
                resultArray.push(`${replaceHTMLEnt(str.substring(item.start - offset, item.start))}`);
                charCount += offset * 2;
            }
            else {
                /// If the match is too close to the end of last match, don't add ellipsis
                resultArray.push(replaceHTMLEnt(str.substring(lastIndex, item.start)));
                charCount += item.start - lastIndex;
            }

            let j = i + 1,
                end = item.end;

            /// Include as many matches as possible
            /// [item.start, end] is the range of the match
            while (j < matches.length && matches[j].start <= end) {
                end = Math.max(matches[j].end, end);
                ++j;
            }

            resultArray.push(`<mark>${replaceHTMLEnt(str.substring(item.start, end))}</mark>`);
            charCount += end - item.start;

            i = j;
            lastIndex = end;

            if (ellipsis && charCount > charLimit) break;
        }

        /// Add the rest of the string
        if (lastIndex < str.length) {
            let end = str.length;
            if (ellipsis) end = Math.min(end, lastIndex + offset);

            resultArray.push(`${replaceHTMLEnt(str.substring(lastIndex, end))}`);

            if (ellipsis && end != str.length) {
                resultArray.push(` [...]`);
            }
        }

        return resultArray.join('');
    }

    private async searchKeywords(keywords: string[]) {
        const rawData = await this.getData();
        const results: pageData[] = [];

        /* michael.gr: When "Whole words only" is checked, each keyword matches only where no letter, digit or underscore
           precedes or follows it.
           We do not use "\b" for that, because it only knows ASCII letters, so Greek words would never match; the "u"
           flag is what lets "\p{L}" and "\p{N}" match letters and digits of every script. */
        const patterns = keywords.filter(v => v.trim() !== '').map(v => {
            const escaped = escapeRegExp(v);
            return this.wholeWords?.checked ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])` : escaped;
        });
        const regex = new RegExp(patterns.join('|'), 'giu');

        /* michael.gr: A post is a result only if it contains every keyword, in its title or its content; when "Match: any
           word" is selected, a post containing any one keyword is a result, which is how the theme originally searched. Each
           keyword is tested with its own regex, because the matches of the combined regex above can miss a keyword:
           with "test" and "testing", "testing" only ever matches "test". */
        const keywordRegexes = patterns.map(p => new RegExp(p, 'iu'));
        const containsKeyword = (item: pageData) => (r: RegExp) => r.test(item.title) || r.test(item.content);
        const anyWord = this.anyWord?.checked ?? false;

        for (const item of rawData) {
            if (anyWord ? !keywordRegexes.some(containsKeyword(item)) : !keywordRegexes.every(containsKeyword(item))) continue;

            const titleMatches: match[] = [],
                contentMatches: match[] = [];

            let result = {
                ...item,
                preview: '',
                matchCount: 0,
                titleMatchCount: 0
            }

            const contentMatchAll = item.content.matchAll(regex);
            for (const match of Array.from(contentMatchAll)) {
                contentMatches.push({
                    start: match.index,
                    end: match.index + match[0].length
                });
            }

            const titleMatchAll = item.title.matchAll(regex);
            for (const match of Array.from(titleMatchAll)) {
                titleMatches.push({
                    start: match.index,
                    end: match.index + match[0].length
                });
            }

            if (titleMatches.length > 0) result.title = Search.processMatches(result.title, titleMatches, false);
            if (contentMatches.length > 0) {
                result.preview = Search.processMatches(result.content, contentMatches);
            }
            else {
                /// If there are no matches in the content, use the first 140 characters as preview
                result.preview = replaceHTMLEnt(result.content.substring(0, 140));
            }

            result.matchCount = titleMatches.length + contentMatches.length;
            result.titleMatchCount = titleMatches.length;
            if (result.matchCount > 0) results.push(result);
        }

        /* michael.gr: Results with title matches come first, ordered by title match count; then the rest, by match
           count. Previously, results were ordered by match count only, so a post with the search term in its title
           usually ended up far below posts that merely mention it often in their body. */
        return results.sort((a, b) => {
            return (b.titleMatchCount - a.titleMatchCount) || (b.matchCount - a.matchCount);
        });
    }

    private async doSearch(keywords: string[]) {
        const startTime = performance.now();

        const results = await this.searchKeywords(keywords);
        this.clear();

        for (const item of results) {
            this.list.append(Search.render(item));
        }

        const endTime = performance.now();

        this.resultTitle.innerText = this.generateResultTitle(results.length, ((endTime - startTime) / 1000).toPrecision(1));

        this.container?.classList.remove('hidden');
    }

    private generateResultTitle(resultLen: number, time: string) {
        return this.resultTitleTemplate.replace("#PAGES_COUNT", resultLen.toString()).replace("#TIME_SECONDS", time);
    }

    public async getData() {
        if (!this.data) {
            /// Not fetched yet
            const jsonURL = this.form.dataset.json as string;
            this.data = await fetch(jsonURL).then(res => res.json());
            const parser = new DOMParser();

            for (const item of this.data) {
                item.content = parser.parseFromString(item.content, 'text/html').body.innerText;
            }
        }

        return this.data;
    }

    private bindSearchForm() {
        let lastSearch = '';

        const eventHandler = (e: Event) => {
            e.preventDefault();
            const keywords = this.input.value.trim();
            const wholeWords = this.wholeWords?.checked ?? false;
            const anyWord = this.anyWord?.checked ?? false;

            Search.updateQueryString(keywords, wholeWords, anyWord, true);

            if (keywords === '') {
                lastSearch = '';
                return this.clear();
            }

            /* michael.gr: The states of "Whole words only" and "Match" are part of lastSearch, so that changing either
               searches again. */
            const search = `${wholeWords} ${anyWord} ${keywords}`;
            if (lastSearch === search) return;
            lastSearch = search;

            this.doSearch(keywords.split(' '));
        }

        this.input.addEventListener('input', eventHandler);
        this.input.addEventListener('compositionend', eventHandler);
        this.wholeWords?.addEventListener('change', eventHandler);
        /* michael.gr: A radio button fires "change" only when it becomes selected, so both radio buttons are listened to. */
        this.form.querySelectorAll('input[name="match"]').forEach(r => r.addEventListener('change', eventHandler));
    }

    private clear() {
        this.list.innerHTML = '';
        this.resultTitle.innerText = '';
        this.container.classList.add('hidden');
    }

    private bindQueryStringChange() {
        window.addEventListener('popstate', (e) => {
            this.handleQueryString()
        })
    }

    private handleQueryString() {
        const pageURL = new URL(window.location.toString());
        const keywords = pageURL.searchParams.get('keyword') || '';
        this.input.value = keywords;
        if (this.wholeWords) this.wholeWords.checked = pageURL.searchParams.get('whole') === '1';
        const anyWord = pageURL.searchParams.get('match') === 'any';
        this.form.querySelectorAll<HTMLInputElement>('input[name="match"]').forEach(r => r.checked = (r.value === 'any') === anyWord);

        if (keywords) {
            this.doSearch(keywords.split(' '));
        }
        else {
            this.clear()
        }
    }

    private static updateQueryString(keywords: string, wholeWords: boolean, anyWord: boolean, replaceState = false) {
        const pageURL = new URL(window.location.toString());

        if (keywords === '') {
            pageURL.searchParams.delete('keyword')
        }
        else {
            pageURL.searchParams.set('keyword', keywords);
        }

        /* michael.gr: "whole=1" is the query string of a search with "Whole words" checked, as submitted by the form. */
        if (wholeWords) {
            pageURL.searchParams.set('whole', '1');
        }
        else {
            pageURL.searchParams.delete('whole');
        }

        /* michael.gr: "match=any" is the query string of a search with "Match: any word" selected, as submitted by the
           form; "match=all" is the default, so it is left out. */
        if (anyWord) {
            pageURL.searchParams.set('match', 'any');
        }
        else {
            pageURL.searchParams.delete('match');
        }

        if (replaceState) {
            window.history.replaceState('', '', pageURL.toString());
        }
        else {
            window.history.pushState('', '', pageURL.toString());
        }
    }

    public static render(item: pageData) {
        return (
            <article>
                <a href={item.permalink}>
                    <div class="article-details">
                        <h2 class="article-title" dangerouslySetInnerHTML={{ __html: item.title }}></h2>
                        <section class="article-preview" dangerouslySetInnerHTML={{ __html: item.preview }}></section>
                    </div>
                    {item.image &&
                        <div class="article-image">
                            <img src={item.image} loading="lazy" />
                        </div>
                    }
                </a>
            </article>
        );
    }
}

declare global {
    interface Window {
        searchResultTitleTemplate: string;
    }
}

window.addEventListener('load', () => {
    setTimeout(function () {
        const searchForm = document.querySelector('.search-form') as HTMLFormElement,
            searchInput = searchForm?.querySelector('input') as HTMLInputElement,
            searchResultList = document.querySelector('.search-result--list') as HTMLDivElement,
            searchResultTitle = document.querySelector('.search-result--title') as HTMLHeadingElement;

        if (!searchForm || !searchInput || !searchResultList || !searchResultTitle) return;

        new Search({
            form: searchForm,
            input: searchInput,
            list: searchResultList,
            resultTitle: searchResultTitle,
            resultTitleTemplate: window.searchResultTitleTemplate
        });
    }, 0);
})

export default Search;