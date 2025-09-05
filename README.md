Rank the notes in a Base by pairwise comparisons using the Elo rating system.
# Motivation
It can be difficult to give an item a rating in a vacuum. What happens if you rate it ten stars, and then find something better later? Do you have to readjust your previous ratings? Do you have to add an eleventh star?

*Why don't you just make ten better and make ten be the top number and make that a little better?*

That's essentially what this plugin does. Given two items, I find it much easier to choose a preference between them than to rate them on their own. By comparing two notes directly, you avoid the ambiguity of absolute ratings and create a dynamic ranking that adjusts as you add more comparisons.
# Design
## Dataset
An Obsidian Base and view defines "What's in scope" for an Elo rating. The Base's filters (or the filters of a specific view, if specified) determine the cohort.
## Starting a Session
An Elo rating session can be started or resumed by:
- Running a command or clicking a sidebar icon while in an Obsidian Base
- Running a command or clicking a sidebar icon while in a note that is in an Elo rating cohort (if the note is in multiple cohorts, a palette will appear for selection)
## Comparison UI
Two random notes from the Base are shown side by side. The user uses keys on the keyboard or buttons on the screen to select the winner. Keyboard controls are configurable in the plugin settings. By default:
- Left arrow to choose left, right arrow to choose right
- Up or down arrows for a draw
- Backspace to undo the last rating
- Escape to end the rating session

After each comparison, a toast notification appears to let the user know the name of the note that won. This can be turned off in the plugin settings.
## Ranking
The Elo algorithm outputs a score. A more human-readable format may be a integer number rank. The plugin can sort notes by their Elo score and give them a rank. Updating many notes in real-time may be inefficient - this could be recalculated at the end of a session or with a command.
## Defining Advanced Behaviour
Advanced behaviour or settings overrides are defined in the Obsidian Base that the Elo rating is running on.

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

      # 2) Define which statistics are shown in the frontmatter of this cohort
      statistics:
        rating:
            property: Rating
            enabled: false
        rank:
          property: Rank
          enabled: true
        matches:
          property: Matches
          enabled: false
        wins:
          property: Wins
          enabled: false
```
