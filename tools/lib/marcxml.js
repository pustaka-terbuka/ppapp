import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import crypto from 'crypto';

export function getControlField(record, tag) {
  if (!record || !record.controlFields) return undefined;
  const field = record.controlFields.find(f => f.tag === tag);
  return field ? field.value : undefined;
}

export function getDataFields(record, tag) {
  if (!record || !record.dataFields) return [];
  return record.dataFields.filter(f => f.tag === tag);
}

export function getSubfield(field, code) {
  if (!field || !field.subfields) return undefined;
  const sf = field.subfields.find(s => s.code === code);
  return sf ? sf.value : undefined;
}

export function getSubfields(field, code) {
  if (!field || !field.subfields) return [];
  return field.subfields.filter(s => s.code === code).map(s => s.value);
}

export function setControlField(record, tag, value) {
  if (!record.controlFields) record.controlFields = [];
  const field = record.controlFields.find(f => f.tag === tag);
  if (field) {
    field.value = value;
  } else {
    record.controlFields.push({ tag, value });
    record.controlFields.sort((a, b) => a.tag.localeCompare(b.tag));
  }
}

export function addDataField(record, field) {
  if (!record.dataFields) record.dataFields = [];
  record.dataFields.push(field);
  record.dataFields.sort((a, b) => a.tag.localeCompare(b.tag));
}

export function removeDataFields(record, tag) {
  if (!record.dataFields) return;
  record.dataFields = record.dataFields.filter(f => f.tag !== tag);
}

export function cloneRecord(record) {
  return JSON.parse(JSON.stringify(record));
}

export function parse(xmlStr) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    isArray: (name, jpath, isLeafNode, isAttribute) => {
      // Very loose path checking for collections/records/fields
      return name === 'marc:record' || name === 'record' ||
             name === 'marc:controlfield' || name === 'controlfield' ||
             name === 'marc:datafield' || name === 'datafield' ||
             name === 'marc:subfield' || name === 'subfield';
    }
  });
  
  const doc = parser.parse(xmlStr);
  if (!doc) return [];
  
  let records = [];
  if (doc['marc:collection'] && doc['marc:collection']['marc:record']) {
    records = doc['marc:collection']['marc:record'];
  } else if (doc.collection && doc.collection.record) {
    records = doc.collection.record;
  } else if (doc['marc:record']) {
    records = doc['marc:record'];
  } else if (doc.record) {
    records = doc.record;
  }
  
  const parseRecord = (rawRec) => {
    const leaderKey = rawRec['marc:leader'] !== undefined ? 'marc:leader' : 'leader';
    const leader = rawRec[leaderKey] !== undefined ? String(rawRec[leaderKey]) : '';
    
    const controlKey = rawRec['marc:controlfield'] !== undefined ? 'marc:controlfield' : 'controlfield';
    const rawControl = rawRec[controlKey] || [];
    const controlFields = rawControl.map(cf => ({
      tag: cf['@_tag'],
      value: cf['#text'] !== undefined ? String(cf['#text']) : ''
    }));
    
    const dataKey = rawRec['marc:datafield'] !== undefined ? 'marc:datafield' : 'datafield';
    const rawData = rawRec[dataKey] || [];
    const dataFields = rawData.map(df => {
      const sfKey = df['marc:subfield'] !== undefined ? 'marc:subfield' : 'subfield';
      const rawSub = df[sfKey] || [];
      return {
        tag: df['@_tag'],
        ind1: df['@_ind1'] || ' ',
        ind2: df['@_ind2'] || ' ',
        subfields: rawSub.map(sf => ({
          code: sf['@_code'],
          value: sf['#text'] !== undefined ? String(sf['#text']) : ''
        }))
      };
    });
    
    return { leader, controlFields, dataFields };
  };
  
  if (Array.isArray(records)) {
    return records.map(parseRecord);
  } else if (typeof records === 'object') {
    return [parseRecord(records)];
  }
  return [];
}

function serializeRecord(record) {
  const result = {};
  if (record.leader) result['marc:leader'] = record.leader;
  
  if (record.controlFields && record.controlFields.length > 0) {
    result['marc:controlfield'] = record.controlFields.map(cf => ({
      '@_tag': cf.tag,
      '#text': cf.value
    }));
  }
  
  if (record.dataFields && record.dataFields.length > 0) {
    result['marc:datafield'] = record.dataFields.map(df => ({
      '@_tag': df.tag,
      '@_ind1': df.ind1 || ' ',
      '@_ind2': df.ind2 || ' ',
      'marc:subfield': df.subfields ? df.subfields.map(sf => ({
        '@_code': sf.code,
        '#text': sf.value
      })) : []
    }));
  }
  
  return result;
}

export function serialize(records) {
  const isArray = Array.isArray(records);
  const recs = isArray ? records : [records];
  
  const obj = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    'marc:collection': {
      '@_xmlns:marc': 'http://www.loc.gov/MARC21/slim',
      'marc:record': recs.map(serializeRecord)
    }
  };
  
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    format: true,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    suppressEmptyNode: true
  });
  
  return builder.build(obj);
}

export function serializeSingleRecord(record) {
  const full = serialize([record]);
  const start = full.indexOf('<marc:record>');
  const end = full.lastIndexOf('</marc:record>') + 14;
  if (start !== -1 && end !== -1) {
    return full.substring(start, end);
  }
  return '';
}

export function contentHash(record) {
  const serialized = serialize(record);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

