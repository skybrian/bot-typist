# Bot Typist for Visual Studio Code


### Q: Yet another AI tool? What does this one do?

A: Bot Typist lets you chat with an AI bot, but in a Jupyter notebook that you've opened in VS Code.

Or to put it another way, it types things into cells that came from a bot. *Bot Typist.* See?

### Q: Okay, why would I want that?

A: If you're like me, it's because you think ChatGPT's ~~Code Interpreter~~ *Advanced Data Analysis* feature is a fun toy, but a terrible substitute for a notebook.

Having a conversation about code in a Python notebook that's running on your own machine has a lot of advantages:

* The Python process doesn't get killed automatically when you're taking a break.
* If you do need to restart Python, you can re-run all the cells.
* You can install whatever Python packages you like.
* You can edit the chat transcript any way you like. This means you can fix mistakes that the bot makes or write code yourself. You aren't forced to always be the back seat driver.

Also, you might want to use some language besides Python? So far, I've added support for TypeScript.

### Q: Will Bot Typist automatically run the code that the bot generates?

A: No, and that's intentional. Since there's no sandbox, I think it's a bit too risky. Instead, you can run the cells yourself. (Hopefully after reading them!)

But the result is still much like Code Interpreter. If running a cell fails with an error, you don't need to say anything, just run the command to get a bot response. The cell's outputs, including any errors, will be included in the prompt. GPT4 will see it, apologize, and try to fix it. It's a little less magical, but this is how Code Interpreter does it anyway.

Also, after getting corrected code, you can delete the mistaken code and the apology if you like. That will conserve context window (and money) as the conversation gets longer.

Another problem this avoids is that when using Code Interpreter, it will often read interpreter output and lie to you about it, claiming that a test passed when it actually failed. I find it's better to read it myself. If you find the output surprising or confusing, you could ask questions about it, though.

### Q: Which bots can I chat with?

A: I mostly use GPT4, but with a little work, you could use any bot you like. Bot Typist uses [Simon Willison's *llm* command](https://llm.datasette.io/) to communicate with the AI. The *llm* command supports several bot API's. It can also run a language model locally on your machine if you've set it up for that. (If it doesn't support the one you want, you could even write a plugin to do it.)

### Q: Why should I write code this way instead of using Copilot?

A: I mostly do it for fun. I've learned a few things about Python programming, too. For example, there's a library called *numpy* that's pretty cool. :)

A more practical use for Bot Typist might be writing coding tutorials? A raw conversation with a bot probably wouldn't make a good tutorial, but you could edit the transcript into something nice.

### Q: Isn't this the same as *(some other tool)*?

A: I probably don't know about it because there are a zillion other AI tools and I can't be bothered to look through them. If it's a good one, maybe me know what you found?

## Features

Bot Typist adds three commands:

`Create: New Jupyter Notebook (for chat)`

This creates a Jupyter notebook with a cell explaining what to do.

`Insert Bot Reply Below`

This is the only command you really need. After typing something into a cell, run this command to add the bot's reply. Since bots are often slow, the reply will stream in like a proper chat should. (Hit escape to interrupt.)

This command is bound to `Command Enter` on Macs and `Control-Option Enter` everywhere, but only works in a text editor in a notebook cell.

`Developer: Show Bot Prompt`

This command opens a new editor with the prompt that would be sent to *llm* for the current cell. (It also displays the system prompt.)

Bot Typist sends everything from in current cell and all previous cells, except that it stops at a horizontal rule in a Markdown cell. You can use a horizontal rule to mark the beginning of a chat, or as a barrier to avoid sending too large a prompt.

And that's all. Not much to it.

## Requirements

It's up to you to [install the *llm* command](https://llm.datasette.io/en/stable/setup.html) and make sure it works. This will include adding whatever API key you need. You also need to install and configure Jupyter.

I like to use [miniconda](https://docs.conda.io/projects/miniconda/en/latest/) and set up two different Python environments, one for *llm* and the other for Jupyter, but you can do it however you like.

## Settings

Required:

- `bot-typist.llm.path` should be set to the full path to the *llm* command.

Optional:

- `bot-typist.llm.systemPrompt` overrides the system prompt if set. (I recommend using a [language-specific setting](https://code.visualstudio.com/docs/getstarted/settings#_language-specific-editor-settings).)

- `bot-typist.llm.model` sets the model. (For example, 'gpt4'.) Otherwise, it uses whatever llm's default model is.

- `bot-typist.llm.stop` sets a stop sequence that controls when the bot's response should be cut off. By default, this is used
to stop the bot if it tries to generate Python output.

- `bot-typist.llm.extraArguments` adds any other arguments you like to the *llm* command.

- `bot-typist.cue` lets you change the label used to indicate the bot's responses. The default is a robot emoji ('🤖').

All these settings can be customized for each programming language.

## Known Issues

* The only way I've tested it is running VS Code locally on a Mac. It might work on Windows, who knows? Send a patch. Getting Bot Typist to work on [vscode.dev](https://vscode.dev/) and/or [Github Codespaces](https://github.com/features/codespaces) might be fun, too, but I've never used them.

* For now, there's no support for creating code cells in any language other than Python or TypeScript. It wouldn't be hard to do, though. Julia anyone?

* There are other notebooks besides Jupyter. Adding support for them might be fun?

## Release Notes

### 0.4.0 - "Deno notebooks are a thing now."

* Added TypeScript support. (Only tested with Deno.)
* Configuration settings can be customized per-language.

### 0.3.0 - "Stopping is important"

* If the bot tries to print Python output, cut if off there.
* Added more settings.
* Added a 'Bot Typist' output panel. It shows the command line sent to LLM and any errors.

### 0.2.0 - "LLM's have lots of options"

Add settings to customize how the llm command is called.

### 0.1.0 - "It works on my machine"

First release. Let's see if anyone likes it.
