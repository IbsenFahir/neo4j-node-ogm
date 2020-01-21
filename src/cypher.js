import { getConnection } from './driver'

const database = getConnection()
class Cypher {
  constructor (stmt = '') {
    this.clean(stmt)
  }

  clean (stmt = '') {
    this.nodes = []
    this.matchs = []
    this.wheres = []
    this.whereString = ''
    this.sets = []
    this.setString = ''
    this.return = {}
    this.returnString = ''
    this.distinct = ''
    this.stmt = stmt
  }

  addWhere ({ attr, operator = '=', value }) {
    const whereString = `${attr} ${operator} ${Number.isInteger(value) ? value : `'${value}'`}`
    this.wheres.push(whereString)
  }

  writeWhere () {
    if (this.wheres.length > 0) {
      this.whereString = ` WITH ${this.nodes.join(', ')}`
      this.whereString = ` WHERE ${this.wheres.join(' AND ')}`
    }
  }

  addReturn (key, value) {
    this.return[key] = value
  }

  match (node, previousAlias = false, relationship = false, targetModel = false, dontPutOnReturn = false) {
    if (targetModel) {
      const relationName = `${node.getAliasName()}_${previousAlias}${relationship}`

      let filterRelationship = ''
      if (targetModel.filter_relationship) {
        filterRelationship = '{' + Object.entries(targetModel.filter_relationship).map(([key, value]) => `${key}:'${value}'`).join(', ') + '}'
      }

      this.matchs.push(`OPTIONAL MATCH (${node.getCypherName()})-[${relationName} ${filterRelationship}]-(${targetModel.getCypherName(previousAlias)})`)
      this.nodes.push(previousAlias)
    } else {
      if (!dontPutOnReturn) {
        this.matchs.push(`MATCH (${node.getCypherName()})`)
        this.nodes.push(node.getAliasName())
        this.addReturn(node.getAliasName(), node)
      } else {
        this.matchs.push(`, (${dontPutOnReturn}:${node.getNodeName()})`)
      }
    }
  }

  addSet (attr, value) {
    if (value) {
      this.sets.push(`${attr} = '${value}'`)
    }
  }

  writeSets (CONCAT = ' AND ') {
    if (this.sets.length > 0) {
      this.setString = `SET ${this.sets.join(CONCAT)}`
    }
  }

  isDistinct (bool = true) {
    this.distinct = bool ? 'DISTINCT' : ''
  }

  writeReturn (nodes, isFind = true) {
    this.isFind = isFind
    for (const [alias, model] of Object.entries(nodes)) {
      this.actualModel = model
      this.modelReturn(alias, model, model.getAliasName())
    }
  }

  modelReturn (alias, model, attributeID, level = 0, wasCollected = false, previous = false) {
    this.returnString += `${alias} {`

    const attrs = []
    let willCollect = false

    attrs.push(`id:id(${attributeID})`)

    // LOOP ON MODEL ATTRIBUTES
    for (const [attr, field] of Object.entries(model._attributes)) {
      if (field.isModel) {
        if (model.checkWith(level, attr, this.actualModel._with) && this.isFind) {
          if (field.isModel && level < 1) {
            willCollect = true
          }
          this.modelReturn(`${attr}:${willCollect ? 'collect(' + attr : attr}`, new field.target(), attr, level + 1, willCollect, { field, model })
        }
      } else {
        if (!model.parent) {
          attrs.push(`.${attr}`)
        }
      }
    }

    if (previous) {
      // THE RELATION HAS ATTRIBUTES
      for (const [relAttr] of Object.entries(previous.field.attributes)) {
        attrs.push(`${relAttr}:${previous.model.getAliasName()}_${attributeID}.${relAttr}`)
      }
    }

    this.returnString += `${attrs.join(', ')} }`

    if (wasCollected && previous) {
      if (previous.field.isArray) {
        this.returnString += ') '
      } else {
        this.returnString += ')[0] '
      }
    }

    if (level > 0) {
      this.returnString += ','
    }
  }

  async create (nodeAlias) {
    this.writeSets(' , ')
    this.writeReturn(this.return)
    const stmt = `CREATE (${nodeAlias}) ${this.whereString} ${this.setString} RETURN ${this.returnString}`
    // console.log(stmt)
    const session = await database.session()

    let result
    try {
      result = await session.run(stmt)
      result = result.records[0]
    } catch (e) {
      result = false
    }

    session.close()
    this.clean()
    return result
  }

  async update () {
    this.writeWhere()
    this.writeSets(' , ')
    this.writeReturn(this.return)
    const stmt = `${this.matchs.join(' ')} ${this.whereString} ${this.setString} RETURN ${this.returnString}`
    // console.log(stmt)
    const session = await database.session()

    let result
    try {
      result = await session.run(stmt)
      result = result.records[0]
    } catch (e) {
      result = false
    }

    session.close()
    this.clean()
    return result
  }

  async delete (alias, detach = false) {
    this.writeWhere()

    const stmt = `${this.matchs.join(' ')} ${this.whereString} ${detach ? 'DETACH' : ''} DELETE ${alias}`
    // console.log(stmt)
    const session = await database.session()

    let result = true
    try {
      await session.run(stmt)
    } catch (e) {
      result = false
    }

    session.close()
    this.clean()
    return result
  }

  async relate (node1, relation, node2, create = true) {
    this.writeWhere()
    this.writeReturn(this.return)
    this.writeSets(' , ')
    const stmt = `${this.matchs.join(' ')} ${this.whereString}
                  ${create ? 'CREATE' : 'MATCH'} (${node1.getAliasName()})-[${node1.getAliasName()}_${relation.attr}:${relation.getLabelName()}]->(${node2.getAliasName()})
                  ${this.setString} RETURN ${this.returnString}`

    const session = database.session()
    // console.log(stmt)
    const result = await session.run(stmt)
    session.close()
    this.clean()
    return result.records[0]
  }

  async find () {
    this.writeWhere()
    this.writeReturn(this.return)
    const stmt = `${this.matchs.join(' ')} ${this.whereString} ${this.setString} RETURN ${this.distinct} ${this.returnString}`

    const session = database.session()
    // console.log(stmt)
    const result = await session.run(stmt)
    session.close()
    this.clean()
    return result.records
  }
}

export { Cypher }
