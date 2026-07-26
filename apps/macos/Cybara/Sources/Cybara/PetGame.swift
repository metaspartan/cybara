import SwiftUI

enum PetCareAction {
    case feed
    case play
    case rest
}

enum PetStage: String {
    case egg
    case hatching
    case baby
    case adult
}

enum PetMood {
    case happy
    case content
    case hungry
    case sleepy
    case bored
}

struct PetGameState: Codable, Equatable {
    var hunger: Int
    var energy: Int
    var joy: Int
    var bond: Int
    var cares: Int
    var updatedAt: Double
}

enum PetGame {
    static let statMax = 100
    static let hungerDecayPerMinute = 1.6
    static let energyDecayPerMinute = 1.1
    static let joyDecayPerMinute = 1.3
    static let maxOfflineMinutes = 12.0 * 60.0
    static let hatchCares = 3
    static let growCares = 8
    static let easterEggTaps = 5
    static let easterEggGapMs = 900.0
    static let storageKey = "cybara.pet.game"

    static func now() -> Double {
        Date().timeIntervalSince1970 * 1000
    }

    static func initialState(at moment: Double = PetGame.now()) -> PetGameState {
        PetGameState(hunger: 80, energy: 80, joy: 80, bond: 0, cares: 0, updatedAt: moment)
    }

    static func clamp(_ value: Double) -> Int {
        guard value.isFinite else { return 0 }
        return max(0, min(statMax, Int(value.rounded())))
    }

    static func decayed(_ state: PetGameState, at moment: Double) -> PetGameState {
        let elapsed = min(maxOfflineMinutes, max(0, (moment - state.updatedAt) / 60_000))
        guard elapsed > 0 else {
            var unchanged = state
            unchanged.updatedAt = moment
            return unchanged
        }
        return PetGameState(
            hunger: clamp(Double(state.hunger) - elapsed * hungerDecayPerMinute),
            energy: clamp(Double(state.energy) - elapsed * energyDecayPerMinute),
            joy: clamp(Double(state.joy) - elapsed * joyDecayPerMinute),
            bond: clamp(Double(state.bond)),
            cares: state.cares,
            updatedAt: moment
        )
    }

    static func applying(
        _ action: PetCareAction,
        to state: PetGameState,
        at moment: Double = PetGame.now()
    ) -> PetGameState {
        let current = decayed(state, at: moment)
        var next = current
        switch action {
        case .feed:
            next.hunger = clamp(Double(current.hunger) + 34)
            next.joy = clamp(Double(current.joy) + 6)
        case .play:
            next.joy = clamp(Double(current.joy) + 30)
            next.energy = clamp(Double(current.energy) - 12)
            next.hunger = clamp(Double(current.hunger) - 6)
        case .rest:
            next.energy = clamp(Double(current.energy) + 36)
            next.joy = clamp(Double(current.joy) - 4)
        }
        let cared = next.hunger > current.hunger
            || next.joy > current.joy
            || next.energy > current.energy
        next.bond = clamp(Double(current.bond) + (cared ? 2 : 0))
        next.cares = current.cares + 1
        next.updatedAt = moment
        return next
    }

    static func stage(of state: PetGameState) -> PetStage {
        if state.cares >= growCares { return .adult }
        if state.cares >= hatchCares { return .baby }
        if state.cares >= hatchCares - 1 { return .hatching }
        return .egg
    }

    static func mood(of state: PetGameState) -> PetMood {
        if state.hunger <= 30 { return .hungry }
        if state.energy <= 30 { return .sleepy }
        if state.joy <= 30 { return .bored }
        if state.hunger >= 70 && state.energy >= 70 && state.joy >= 70 { return .happy }
        return .content
    }

    static func moodLabel(_ mood: PetMood) -> String {
        switch mood {
        case .hungry: return "Wants a snack"
        case .sleepy: return "Getting sleepy"
        case .bored: return "Wants to play"
        case .happy: return "Thriving"
        case .content: return "Doing fine"
        }
    }

    static func level(of state: PetGameState) -> Int {
        1 + state.bond / 20
    }

    static func registerTap(
        taps: Int,
        lastTapAt: Double,
        at moment: Double
    ) -> (taps: Int, unlocked: Bool) {
        let next = moment - lastTapAt <= easterEggGapMs ? taps + 1 : 1
        let unlocked = next >= easterEggTaps
        return (unlocked ? 0 : next, unlocked)
    }

    static func load(from defaults: UserDefaults = .standard) -> PetGameState {
        guard
            let data = defaults.string(forKey: storageKey)?.data(using: .utf8),
            let stored = try? JSONDecoder().decode(PetGameState.self, from: data)
        else {
            return initialState()
        }
        return decayed(stored, at: now())
    }

    static func save(_ state: PetGameState, to defaults: UserDefaults = .standard) {
        guard
            let data = try? JSONEncoder().encode(state),
            let text = String(data: data, encoding: .utf8)
        else { return }
        defaults.set(text, forKey: storageKey)
    }
}

enum PetSprite {
    static let width = 16

    static let palette: [Character: Color] = [
        "o": Color(red: 0.231, green: 0.141, blue: 0.086),
        "f": Color(red: 0.776, green: 0.541, blue: 0.322),
        "d": Color(red: 0.549, green: 0.353, blue: 0.180),
        "m": Color(red: 0.604, green: 0.639, blue: 0.678),
        "e": Color(red: 0.141, green: 0.075, blue: 0.035),
        "w": Color.white,
        "r": Color(red: 0.961, green: 0.510, blue: 0.125),
        "c": Color(red: 0.949, green: 0.894, blue: 0.808),
        "l": Color(red: 0.875, green: 0.682, blue: 0.471),
        "s": Color(red: 0.659, green: 0.439, blue: 0.220),
    ]

    static let egg = [
        "................",
        "......oooo......",
        ".....occcco.....",
        "....occcccco....",
        "...occcccccco...",
        "...occcccccco...",
        "..occcccccccco..",
        "..orrccccccrro..",
        "..occcccccccco..",
        "..orrccccccrro..",
        "..occcccccccco..",
        "...occcccccco...",
        "....occcccco....",
        ".....occcco.....",
        "......oooo......",
        "................",
    ]

    static let eggCrack = [
        "................",
        "......oooo......",
        ".....occcco.....",
        "....occcccco....",
        "...occcccccco...",
        "...occoccocco...",
        "..occcoccoccco..",
        "..orrccccccrro..",
        "..occoccccocco..",
        "..orrccccccrro..",
        "..occcccccccco..",
        "...occcccccco...",
        "....occcccco....",
        ".....occcco.....",
        "......oooo......",
        "................",
    ]

    static let baby = [
        "................",
        "................",
        "................",
        "........r.......",
        ".......oro......",
        ".....oooooo.....",
        "....offffffo....",
        "....offffffo....",
        "....owffffwo....",
        "....offffffo....",
        "....offleffo....",
        "....offssffo....",
        ".....oooooo.....",
        ".....oo..oo.....",
        "................",
        "................",
    ]

    static let adult = [
        "................",
        ".......rr.......",
        "......orro......",
        "...oooooooooo...",
        ".ooffffffffffoo.",
        ".offffffffffffo.",
        ".offffffffffffo.",
        ".offweffffweffo.",
        ".offeeffffeeffo.",
        ".offffffffffmmo.",
        ".offflleellfffo.",
        ".offfllllllfffo.",
        ".offffssssssffo.",
        "..offsssssssfo..",
        "...oooooooooo...",
        "...oo......oo...",
    ]

    static let adultBlink: [String] = adult.enumerated().map { index, row in
        guard index == 7 || index == 8 else { return row }
        return row
            .replacingOccurrences(of: "we", with: "ff")
            .replacingOccurrences(of: "ee", with: "ff")
    }

    static let adultSleep: [String] = adult.enumerated().map { index, row in
        if index == 7 { return row.replacingOccurrences(of: "we", with: "oo") }
        if index == 8 { return row.replacingOccurrences(of: "ee", with: "ff") }
        return row
    }

    static func rows(for stage: PetStage, mood: PetMood, blink: Bool) -> [String] {
        switch stage {
        case .egg: return egg
        case .hatching: return eggCrack
        case .baby: return baby
        case .adult:
            if mood == .sleepy { return adultSleep }
            return blink ? adultBlink : adult
        }
    }
}

struct PetSpriteView: View {
    let rows: [String]
    let scale: CGFloat

    var body: some View {
        Canvas { context, _ in
            for (y, row) in rows.enumerated() {
                for (x, character) in row.enumerated() {
                    guard let color = PetSprite.palette[character] else { continue }
                    context.fill(
                        Path(
                            CGRect(
                                x: CGFloat(x) * scale,
                                y: CGFloat(y) * scale,
                                width: scale,
                                height: scale
                            )
                        ),
                        with: .color(color)
                    )
                }
            }
        }
        .frame(
            width: CGFloat(PetSprite.width) * scale,
            height: CGFloat(rows.count) * scale
        )
        .accessibilityLabel("Pixel art Cybara")
    }
}
