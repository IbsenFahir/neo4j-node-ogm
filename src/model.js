import { Cypher } from './cypher'
import { Collection } from './collection'
import { createGetterAndSetter, convertID } from './utils'
import { hydrate, checkWith, setWith } from './hydrate'

class Model {
  /**
   * Constructor
   *
   * @param {Object} values
   */
  constructor(values = {}, labels = [], attributes = {}) {
    this._with = []
    this._values = values
    this._labels = labels
    this._attributes = attributes
    this._alias = null
    this.filter_attributes = []
    Object.entries(attributes).forEach(([key, field]) => {
      createGetterAndSetter(this, key, field.set, field.get)
    })
    Object.entries(values).forEach(([key, value]) => {
      this[key] = value
    })
  }

  /**
   * Start the retrieve Info based on actual Node
   */
  toJSON() {
    return this.retriveInfo(this)
  }

  /**
   * Retrieve Info from Node as a JSON, only with clean data
   *
   * @param {Object} model
   */
  retriveInfo(model, previous) {
    const data = {}
    data.id = model.id

    //attributes of relations
    if (previous) {
      for (const [relKey] of Object.entries(previous.attributes)) {
        if (model._values[relKey]) data[relKey] = model._values[relKey]
      }
    }

    Object.entries(model._attributes).forEach(([key, field]) => {
      switch (field.type) {
        case 'hash':
          break
        case 'relationship':
          if (model._values[key]) data[key] = this.retriveInfo(model._values[key], field)
          break
        case 'relationships':
          if (model._values[key]) {
            data[key] = Object.values(model._values[key]).map(item => this.retriveInfo(item, field))
          }
          break
        default:
          data[key] = model[key]
      }
    })

    return data
  }

  getAliasName() {
    return this._alias ?? this._labels.join('').toLowerCase()
  }

  getNodeName() {
    return this._labels.join(':')
  }

  getCypherName(aliasName = false) {
    if (aliasName) {
      return aliasName + ':' + this.getNodeName()
    }

    return this.getAliasName() + ':' + this.getNodeName()
  }

  getAttributes() {
    return Object.entries(this._attributes)
  }

  writeFilter(forNode, relationAlias = undefined) {
    // FILTERS WITH LOCATION
    this.filter_attributes
      .filter(item => item.for === forNode || item.for === relationAlias)
      .forEach(({ attr, operator, value }) => {
        this.cypher.addWhere({ attr, operator, value })
      })
    this.cypher.matchs.push(this.cypher.writeWhere())
  }

  writeOrderBy() {
    // FILTERS WITH LOCATION
    this.order_by.forEach(({ attr, direction }) => {
      this.cypher.addOrderBy(attr, direction)
    })
  }

  doMatchs(node, relation, level = 0) {
    if (relation) {
      this.cypher.match(relation.previousNode, relation.previousAlias, relation.relationship, node)
    } else {
      this.cypher.match(node)
    }

    this.writeFilter(node.getAliasName(), `${relation?.previousNode?.getAliasName()}_${relation?.previousAlias}`)

    Object.keys(node._attributes).forEach(key => {
      const field = node._attributes[key]
      if (field.isModel) {
        if (checkWith(level, key, this._with)) {
          const newNode = new field.target()
          newNode.filter_relationship = field.filter_relationship
          newNode._alias = key
          this.doMatchs(
            newNode,
            {
              relationship: `:${field.labels.join(':')}`,
              previousNode: node,
              previousAlias: key,
            },
            level + 1
          )
        }
      }
    })

    return true
  }

  addMatchs(node, attr) {
    this.cypher.match(node, false, false, false, attr)
    this.writeFilter(attr, `${node.getAliasName()}_${attr}`)
  }

  async fetch(with_related = []) {
    return this.constructor.findAll({
      filter_attributes: [{ key: `id(${this.getAliasName()})`, value: this.id, order: 0 }],
      with_related,
      parent: this,
    })
  }

  async delete(detach = false) {
    this.cypher = new Cypher()
    this.filter_attributes = [
      {
        key: `id(${this.getAliasName()})`,
        value: this.id,
      },
    ]
    this.doMatchs(this, false)

    const data = await this.cypher.delete(this.getAliasName(), detach)
    return data
  }

  setAttributes(create = true) {
    Object.entries(this._attributes).forEach(([key, field]) => {
      const defaultValue = field.hasDefaultValue(this._values[key])
      if (defaultValue) this[key] = defaultValue

      this._values[key] = field.checkValidation(key, this._values[key])
      if (field.isModel === false) {
        this.cypher.addSet(this.getAliasName() + '.' + key, this._values[key])
      } else if (create) {
        // TODO: add the relation
      }
    })
  }

  async save() {
    this.cypher = new Cypher()
    if (this.id === undefined) {
      // create
      this.doMatchs(this, false)

      this.setAttributes(false)

      const record = await this.cypher.create(this.getCypherName())

      hydrate(this, record, this.getAliasName())
    } else {
      // update
      this.cypher.addWhere({
        attr: `id(${this.getAliasName()})`,
        value: this.id,
      })
      this.cypher.isDistinct()
      this.doMatchs(this, false)

      this.setAttributes()

      const record = await this.cypher.update()

      hydrate(this, record, this.getAliasName())
    }
  }

  /**
   * Relate nodes
   *
   * @param {String} attr
   * @param {Model} node
   * @param {JSON} attributes
   */
  async relate(attr, node, attributes = {}, create = true) {
    // ADD TO _WITH TO RETURN THE RELATION
    this._with = []
    this.cypher = new Cypher()
    this.filter_attributes = [
      {
        key: `id(${this.getAliasName()})`,
        value: this.id,
      },
      {
        key: `id(${attr})`,
        value: node.id,
      },
    ].map(fa => this.prepareFilter(fa, this))
    this.doMatchs(this)
    this.addMatchs(node, attr)
    // ADD TO _WITH TO RETURN THE RELATION
    this._with = [[attr]]
    setWith(this._with) // used on hydrate
    // ADD THE ATTRIBUTES ON RELATION
    Object.entries(attributes).forEach(([key, value]) => {
      this.cypher.addSet(this.getAliasName() + '_' + attr + '.' + key, value)
    })
    // CREATE THE RELATION
    const field = this._attributes[attr]
    field.attr = attr
    const record = await this.cypher.relate(this, field, node, create)

    hydrate(this, record, this.getAliasName())
  }

  /**
   * Update a relation between the nodes
   *
   * @param {String} attr
   * @param {Model} node
   * @param {JSON} attributes
   */
  async updateRelationship(attr, node, attributes = {}) {
    return this.relate(attr, node, attributes, false)
  }

  /**
   * Create a relation between the nodes
   *
   * @param {String} attr
   * @param {Model} node
   * @param {JSON} attributes
   */
  async createRelationship(attr, node, attributes = {}) {
    return this.relate(attr, node, attributes, true)
  }

  /**
   * Remove the relations about that attribute
   *
   * @param {String} attr
   */
  async removeAllRelationships(attr) {
    this.cypher = new Cypher()
    this._with = [[attr]]
    this.cypher.optional = false
    this.filter_attributes = [
      {
        attr: `id(${this.getAliasName()})`,
        value: this.id,
      },
    ].map(fa => this.prepareFilter(fa, this))
    this.doMatchs(this)
    return this.cypher.delete(`${this.getAliasName()}_${attr}`)
  }

  /**
   * Remove the one single relationship based on other node
   *
   * @param {String} attr
   */
  async removeRelationship(attr, node) {
    this.cypher = new Cypher()
    this._with = [[attr]]
    this.cypher.optional = false
    this.filter_attributes = [
      {
        key: `id(${this.getAliasName()})`,
        value: this.id,
      },
      {
        key: `id(${attr})`,
        value: node.id,
      },
    ].map(fa => this.prepareFilter(fa, this))

    this.doMatchs(this)

    return this.cypher.delete(`${this.getAliasName()}_${attr}`)
  }

  /**
   * Create a new relation and remove the older
   *
   * @param {String} attr
   * @param {Model} node
   * @param {JSON} attributes
   */
  async recreateRelationship(attr, node, attributes = {}) {
    try {
      await this.removeRelationship(attr)
    } catch (e) {
      // nothing
    }

    try {
      const data = await this.relate(attr, node, attributes, true)
      return data
    } catch (e) {
      throw new Error('new relation is not possible')
    }
  }

  static async findByID(id, config = {}) {
    const self = new this()

    config.filter_attributes = [
      {
        key: `id(${self.getAliasName()})`,
        value: parseInt(id, 10),
      },
    ].concat(config.filter_attributes)

    const data = await this.findAll(config)
    return data[0]
  }

  static async findBy(filter_attributes = [], config = {}) {
    config.filter_attributes = filter_attributes
    return this.findAll(config)
  }

  static async findAll(config = {}) {
    let self
    if (!config.parent) {
      self = new this()
    } else {
      self = config.parent
      self.parent = true
    }

    Object.keys(config).forEach(key => {
      config[key] === undefined && delete config[key]
    })
    config = Object.assign(
      {
        with_related: [],
        filter_attributes: [],
        onlyRelation: false,
        order_by: [],
        skip: '',
        limit: '',
        optional: true,
      },
      config
    )

    config.with_related.forEach(item => {
      const w = item.split('__')
      self._with.push(w)
    })
    setWith(self._with)

    self.cypher = new Cypher()
    // self.cypher.isDistinct()
    self.cypher.optional = config.optional
    self.cypher.skip = config.skip
    self.cypher.limit = config.limit
    self.filter_attributes = config.filter_attributes.map(fa => self.prepareFilter(fa, self))

    self.order_by = config.order_by.map(ob => {
      const isCypherFunction = /.+\(.+\)/.test(ob.key)
      if (isCypherFunction) {
        throw new Error('Functions is not allowed in order_by')
      } else {
        ob.for = ob.key.split('.').length > 1 ? ob.key.split('.')[0] : self.getAliasName()
        ob.attr = ob.key.split('.').length > 1 ? ob.key : `${self.getAliasName()}.${ob.key}`
      }

      return ob
    })
    self.doMatchs(self, false, 0)
    self.writeOrderBy()

    const data = await self.cypher.find()

    const result = new Collection()
    const ids = []
    data.forEach(record => {
      let model = new this()
      const main = record._fields[record._fieldLookup[model.getAliasName()]]
      const id = convertID(main.id)

      if (config.parent) {
        model = config.parent
      }

      if (ids.includes(id)) {
        model = result[ids.indexOf(id)]
      } else {
        ids.push(id)
      }

      result[ids.indexOf(id)] = hydrate(model, record, model.getAliasName())
    })

    return result
  }

  prepareFilter(fa, model) {
    if (!fa) return false
    const isCypherFunction = /.+\(.+\)/.test(fa.key)
    if (isCypherFunction) {
      const regExp = /\(([^)]+)\)/
      const matches = regExp.exec(fa.key)

      //matches[1] contains the value between the parentheses
      fa.for = matches[1]
      fa.attr = fa.key
    } else {
      fa.for = fa.key.split('.').length > 1 ? fa.key.split('.')[0] : model.getAliasName()
      fa.attr = fa.key.split('.').length > 1 ? fa.key : `${model.getAliasName()}.${fa.key}`
    }
    return fa
  }
}

export { Model }
