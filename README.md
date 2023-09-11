# Bot Typist for Visual Studio Code

### Q: Yet another AI extension. What does this one do?

A: Bot Typist lets you chat with an AI bot, but in a Jupyter notebook that you've opened in VS Code.

### Q: Why would I want to do that?

A: If you're like me, it's because you think ChatGPT's ~~Code Interpreter~~ *Advanced Data Analysis* feature is a fun toy, but a terrible substitute for a notebook.

Bot Typist lets you do almost the same thing, except that Python is running on your own machine. The chat transcript is already in your editor. The Python process doesn't get killed automatically when you're taking a break. Also, when you do restart it, you can easily re-run all the cells. You can also install whatever Python packages you like.

Another big improvement: instead of always being the backseat driver, you can jump in and edit the code at any time.

### Q: Will Bot Typist automatically run Python code that the bot generates?

A: No, and that's intentional. Since there's no sandbox, I think it's a bit too risky. Instead, you can run the cells it inserted yourself, hopefully after reading them.

You can achieve a similar effect as Code Interpreter by running the cells yourself and then getting another reply from the bot. If there's an obvious error, you don't need to say anything more. Cell output including any errors will be included in the prompt. GPT4 will see it, apologize, and try to fix it. It's a little less magical, but this is what Code Interpreter is doing anyway.

Then you can delete the mistaken code and the apology if you like. That will conserve context window and money as the conversation gets longer.

Another good thing about doing it this way is that GPT4 won't read Python output and lie to you about it. Normally it's better to read it yourself. If it's surprising or confusing, you could ask questions about it, though.

### Q: Which bots can I chat with?

A: I mostly use GPT4, but with a little work, you could use any bot you like. Bot Typist uses [Simon Willison's *llm* command](https://llm.datasette.io/) to communicate with the AI. The *llm* command supports several bot API's. It can also run a language model locally on your machine if you've set it up for that. (If it doesn't support the one you want, you could write an llm plugin for it.)

### Q: Why should I write code this way instead of using Copilot?

A: I mostly do it for fun, and I've learned a few things about Python programming, too. For example, there's a library called *numpy* that's pretty cool. :)

A more practical use for Bot Typist might be writing coding tutorials? A raw conversation with a bot probably wouldn't make a good tutorial, but you could edit it into something nice.

### Q: Isn't this the same as *(some other tool)*?

A: I probably don't know about it because there are a zillion other AI tools and I can't be bothered to look through them. If it's a good one, maybe me know what you found?

## Features

Bot Typist adds three commands:

`Create: New Jupyter Notebook (for chat)`

This creates a Jupyter notebook with a cell explaining what to do.

`Insert Bot Reply Below`

This is the only command you really need. After typing something into a cell, run this command to add the bot's reply. Since bots are often slow, the reply will stream in like a proper chat should. (Hit escape to interrupt.)

This command is bound to `Command Enter` on Macs and `Control-Option Enter` everywhere, but only works in a text editor in a notebook.

`Developer: Show Bot Prompt`

This command opens another editor, showing you the prompt that will be sent to *llm* for the current cell. (It also displays the system prompt.)

Bot Typist sends everything from the current cell and above, except that it stops at a horizontal rule in a Markdown cell. That way you can use a horizontal rule to mark the beginning of a chat.

And that's all. Not much to it.

## Requirements

It's up to you to [install the llm command](https://llm.datasette.io/en/stable/setup.html) and make sure it works. This will include adding whatever API key you need. You also need to install and configure Jupyter.

I like to use [miniconda](https://docs.conda.io/projects/miniconda/en/latest/) and set up two different Python environments, one for llm and the other for Jupyter, but you can do it however you like.

## Settings

- `bot-typist.llm.path` should be set to the full path to the 'llm' command.

## Known Issues

* I've only tested it running VS Code locally on a Mac. It might work on Windows, who knows? Send a patch.

* Running Bot Typist on vscode.dev and/or Github Codespaces might be fun? I've never used them. It might mean communicating with the bot in a different way.

* For now, there's no support for creating code cells in any language other than Python. It wouldn't be hard to do, though. Julia anyone?

* There are other notebooks besides Jupyter. Adding support for them might be fun?

* Bot Typist will run *llm* without the *-m* flag and get whichever model the *llm* command has configured as its default. (Yes, this should probably be a setting.) You can get a similar effect by using a separate Python environment, though.

* The system prompt should be configurable.

## Release Notes

### 0.1 - "It works on my machine"

First release. Maybe the only release? Let's see if anyone likes it.
