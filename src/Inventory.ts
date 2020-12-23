import { Bot } from 'mineflayer'
import { Callback } from './CollectBlock'
import { Vec3 } from 'vec3'
import { Item } from 'prismarine-item'
import { goals } from 'mineflayer-pathfinder'
import { NoChestsError } from './NoChestsError'

export type ItemFilter = (item: Item) => boolean

function getClosestChest (bot: Bot, chestLocations: Vec3[]): Vec3 | null {
  let chest = null
  let distance = 0

  for (const c of chestLocations) {
    const dist = c.distanceTo(bot.entity.position)
    if (chest == null || dist < distance) {
      chest = c
      distance = dist
    }
  }

  if (chest != null) {
    chestLocations.splice(chestLocations.indexOf(chest), 1)
  }

  return chest
}

export function emptyInventoryIfFull (bot: Bot, chestLocations: Vec3[], itemFilter: ItemFilter, cb: Callback): void {
  if (bot.inventory.emptySlotCount() > 0) {
    cb()
    return
  }

  emptyInventory(bot, chestLocations, itemFilter, cb)
}

export function emptyInventory (bot: Bot, chestLocations: Vec3[], itemFilter: ItemFilter, cb: Callback): void {
  if (chestLocations.length === 0) {
    cb(new NoChestsError('There are no defined chest locations to empty inventory!'))
    return
  }

  // Shallow clone so we can safely remove chests from the list that are full.
  chestLocations = [...chestLocations]

  const tryNextChest = (): void => {
    const chest = getClosestChest(bot, chestLocations)

    if (chest == null) {
      cb(new NoChestsError('All chests are full!'))
      return
    }

    tryEmptyInventory(bot, chest, itemFilter, (err: Error | undefined, hasRemaining: boolean): void => {
      if (err != null) {
        cb(err)
        return
      }

      if (!hasRemaining) {
        cb()
        return
      }

      tryNextChest()
    })
  }

  tryNextChest()
}

function tryEmptyInventory (bot: Bot, chestLocation: Vec3, itemFilter: ItemFilter, cb: (err: Error | undefined, hasRemaining: boolean) => void): void {
  gotoChest(bot, chestLocation, (err?: Error) => {
    if (err != null) {
      cb(err, true)
      return
    }

    placeItems(bot, chestLocation, itemFilter, cb)
  })
}

function gotoChest (bot: Bot, location: Vec3, cb: Callback): void {
  // @ts-expect-error
  const pathfinder: Pathfinder = bot.pathfinder
  pathfinder.goto(new goals.GoalBlock(location.x, location.y, location.z), cb)
}

function placeItems (bot: Bot, chestPos: Vec3, itemFilter: ItemFilter, cb: (err: Error | undefined, hasRemaining: boolean) => void): void {
  const chestBlock = bot.blockAt(chestPos)
  if (chestBlock == null) {
    cb(new Error('Chest is in an unloaded chunk!'), true)
    return
  }

  try {
    const chest = bot.openChest(chestBlock)
    let itemsRemain = false
    chest.once('open', () => {
      const tryDepositItem = (item: Item, cb2: Callback): void => {
        // @ts-expect-error ; A workaround for checking if the chest is already full
        if (chest.items().length >= chest.window.inventoryStart) {
          // Mark that we have items that didn't fit.
          itemsRemain = true

          cb2()
          return
        }

        chest.deposit(item.type, item.metadata, item.count).then(() => cb2()).catch(err => cb2(err))
      }

      const taskQueue = new TaskQueue()
      for (const item of bot.inventory.items()) {
        if (itemFilter(item)) { taskQueue.add(cb3 => tryDepositItem(item, cb3)) }
      }

      taskQueue.addSync(() => chest.close())

      taskQueue.runAll((err?: Error) => {
        if (err != null) {
          cb(err, true)
          return
        }

        cb(undefined, itemsRemain)
      })
    })
  } catch (err) {
    // Sometimes open chest will throw a few asserts if block is not a chest
    cb(err, true)
  }
}
