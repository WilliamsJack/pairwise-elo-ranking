Rank the notes in a Base by pairwise comparisons using the Elo rating system.
# Motivation
Rate and rank notes by pairwise comparison using the Elo rating system.

It can be difficult to give an item a rating in a vacuum. What happens if you rate it ten stars, and then find something better later? Do you have to readjust your previous ratings? Do you have to add an eleventh star?

*Why don't you just make ten better and make ten be the top number and make that a little better?*

That's essentially what this plugin does. Given two items, I find it much easier to choose a preference between them than to rate them on their own. By comparing two notes directly, you avoid the ambiguity of absolute ratings and create a dynamic ranking that adjusts as you add more comparisons.
# Design
## Dataset
An Obsidian Base and view defines "What's in scope" for an Elo rating. The Base's filters (or the filters of a specific view, if specified) determine the cohort.
The [[Elo Rating Obsidian Plugin#Elo Block|Elo Block]] contains a link to the Base and view that determined the current note's cohort.
## Launch Contexts
An Elo rating session can be started or resumed by:
- Running a command or clicking a sidebar icon while in an Obsidian Base
- Running a command or clicking a sidebar icon while in a note that contains an Elo block (if multiple Elo blocks, bring up a palette for selection)
## Comparison UI
Two random notes from the Base are shown side by side. The user uses keys on the keyboard or buttons on the screen. Keyboard shortcuts are configurable in the plugin settings, and can even be multiple keys.
- Left arrow to choose left, right arrow to choose right
- Up or down arrows for a draw
- Backspace to undo the last rating
- Escape to end the rating session

After each comparison, a toast notification appears to let the user know the name of the note that won. This can be turned off in the plugin settings.
## Ranking
The Elo algorithm outputs a score. A more human-readable format may be a integer number rank. The plugin can sort notes by their Elo score and give them a rank. Updating many notes in real-time may be inefficient - this could be recalculated at the end of a session or with a command.
## Elo Block
Every note that is part of an Elo rating will have an Elo block. A note can have multiple Elo blocks.

Each Elo block links to an Obsidian Base, which defines the behaviour of the Elo rating.

> Elo: [[Daily Photo.base]]
> Score: 1606.570927336755
> Matches: 17
> Wins: 15

*Note: Only `Score` is required for an Elo rating. The other fields are optional (defined in the Base/Elo Rating Note) and provide additional statistics about the note's performance.*
## Defining Advanced Behaviour
Advanced behaviour is defined in the Obsidian Base that the Elo rating is running on.

Example Base with Elo plugin configuration:
```base
filters:
  and:
    - file.ext.lower() == "md"
    - file.hasTag("Personal/Life/Recipe")
    - '!file.name.lower().contains("template")'
formulas:
  firstImage: '[file.embeds, file.links].flat().filter(value.asFile() && ["png","jpg","jpeg","gif","webp","svg","bmp","avif","tif","tiff"].contains(value.asFile().ext.lower()))[0]'
  cover: if(formula.firstImage, image(formula.firstImage.asFile()))
  mealTag: file.tags.map(value.replace(/^#/, "")).filter(value.startsWith("Personal/Life/Recipe/"))[0]
  mealCourse: if(formula.mealTag, formula.mealTag.split("/")[3], "Uncategorised")
  title: file.asLink()
properties:
  formula.cover:
    displayName: Photo
  formula.title:
    displayName: Recipe
  formula.mealCourse:
    displayName: Course
views:
  - type: cards
    name: Recipes
    order:
      - file.name
      - formula.mealCourse
      - Serves
      - Diet
    image: formula.cover

    # Elo plugin configuration
    elo:
      # 1) Pairing preferences
      pairing:
        preferSimilar: true     # Prefer pairing notes with similar Elo scores
        preferLowMatches: true  # Prefer pairing notes with fewer matches

      # 2) Define where statistics are shown and how they are labelled
      # Results from the Elo block can be mirrored to frontmatter properties.
      statistics:
        rating:  # Rating is the only required statistic.
          eloBlock:
            name: Rating
          frontmatterMirror:
            enabled: false
            property: eloRating
        rank:
          eloBlock:
            enabled: true
            name: Rank
          frontmatterMirror:
            enabled: true
            property: Rank
        matches:
          eloBlock:
            enabled: true
            name: Matches
          frontmatterMirror:
            enabled: false
            property: eloMatches
        wins:
          eloBlock:
            enabled: true
            name: Wins
          frontmatterMirror:
            enabled: false
            property: eloWins
```
