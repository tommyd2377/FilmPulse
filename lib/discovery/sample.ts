import { buildSnapshot } from "./catalog"
import { randomUUID } from "node:crypto"
import { STREAMING_SERVICES, catalogKey, type CatalogMovie, type CatalogSnapshot } from "./types"

// Offline fixtures only. These are not claims about current streaming availability.
const films: [number, string, number, number[], string][] = [
  [329865, "Arrival", 2016, [878, 18], "A linguist searches for meaning when mysterious visitors arrive on Earth."],
  [565743, "The Vast of Night", 2019, [878, 9648], "Two young people follow a strange radio signal through a small town."],
  [502033, "Sound of Metal", 2019, [18, 10402], "A drummer faces a life-changing loss of hearing."],
  [776503, "CODA", 2021, [18, 10402], "A young singer navigates her dreams and her family's changing world."],
  [264660, "Ex Machina", 2014, [878, 53], "A programmer is invited to evaluate an extraordinary artificial intelligence."],
  [152601, "Her", 2013, [878, 10749, 18], "An unexpected connection changes a lonely writer's life."],
  [704882, "Wolfwalkers", 2020, [16, 12, 14], "A young hunter encounters a world of magic in an Irish forest."],
  [371645, "Hunt for the Wilderpeople", 2016, [12, 35, 18], "An unlikely pair become the subjects of a wilderness manhunt."],
  [370755, "Paterson", 2016, [18], "A bus driver finds poetry in the small rhythms of everyday life."],
  [334541, "Manchester by the Sea", 2016, [18], "An unexpected responsibility draws a man back to his hometown."],
  [335984, "Blade Runner 2049", 2017, [878, 9648], "A discovery leads a detective through a changing future."],
  [399174, "Isle of Dogs", 2018, [16, 12, 35], "A boy searches for his dog on an island of exiles."],
  [334543, "Lion", 2016, [18], "A young man searches for a home he remembers only in fragments."],
  [254320, "The Lobster", 2015, [35, 10749, 878], "A strange society demands that its citizens find a partner."],
  [264644, "Room", 2015, [18], "A mother and son confront a world beyond the one they know."],
  [222935, "The Fault in Our Stars", 2014, [10749, 18], "Two teenagers form a connection that changes their lives."],
  [68727, "Trance", 2013, [53, 80, 9648], "A missing painting sets off a puzzle of unreliable memories."],
  [106646, "The Wolf of Wall Street", 2013, [80, 35, 18], "An ambitious stockbroker's rise spirals into excess."],
  [313369, "La La Land", 2016, [10402, 10749, 18], "An actor and a musician pursue their ambitions in Los Angeles."],
  [120467, "The Grand Budapest Hotel", 2014, [35, 12], "A concierge and his young protégé are swept into an elaborate adventure."],
  [19995, "Avatar", 2009, [878, 12], "A visitor to a distant moon finds himself caught between two worlds."],
  [27205, "Inception", 2010, [878, 28, 53], "A team attempts to plant an idea inside a dream."],
  [157336, "Interstellar", 2014, [878, 12, 18], "Explorers venture beyond Earth in search of a future for humanity."],
  [359940, "Three Billboards Outside Ebbing, Missouri", 2017, [18, 80], "A mother's public challenge unsettles a small town."],
]

export const SAMPLE_MOVIES: CatalogMovie[] = films.map(([tmdbId, title, releaseYear, genreIds, overview], index) => ({
  tmdbId, title, releaseYear, genreIds, overview, posterPath: null,
  popularity: 100 - index * 3, voteAverage: 7 + (index % 8) / 10, voteCount: 100 + index * 31, originalLanguage: "en",
}))

export function sampleSnapshots(): CatalogSnapshot[] {
  const completedAt = new Date().toISOString()
  return [...STREAMING_SERVICES.map(service => service.key), "rentals", "purchases", "theaters"].map((service, index) => buildSnapshot({
    id: randomUUID(), key: catalogKey("US", service), service: service as CatalogSnapshot["manifest"]["service"], region: "US",
    access: service === "theaters" ? "theaters" : service === "rentals" ? "rent" : service === "purchases" ? "buy" : "subscription",
    source: "sample", completedAt, checkedAt: completedAt,
  }, SAMPLE_MOVIES.filter((_, movieIndex) => movieIndex % 5 !== index % 5)))
}
